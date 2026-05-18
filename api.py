from __future__ import annotations

import os
import tempfile
import math
from collections import Counter
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="Audio Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Model lazy-loading
# ---------------------------------------------------------------------------

_whisper_model = None
_sentiment_pipe = None

MODEL_CACHE_DIR = os.path.join(os.path.dirname(__file__), "model_cache")
os.makedirs(MODEL_CACHE_DIR, exist_ok=True)


def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel

        os.environ.setdefault("HF_HOME", MODEL_CACHE_DIR)
        os.environ.setdefault("XDG_CACHE_HOME", MODEL_CACHE_DIR)

        try:
            _whisper_model = WhisperModel(
                "tiny",
                device="cpu",
                compute_type="int8",
                download_root=MODEL_CACHE_DIR,
            )
        except Exception:
            _whisper_model = WhisperModel(
                "base",
                device="cpu",
                compute_type="int8",
                download_root=MODEL_CACHE_DIR,
            )
    return _whisper_model


def get_sentiment_pipe():
    global _sentiment_pipe
    if _sentiment_pipe is None:
        from transformers import pipeline

        os.environ.setdefault("TRANSFORMERS_CACHE", MODEL_CACHE_DIR)
        os.environ.setdefault("HF_HOME", MODEL_CACHE_DIR)

        _sentiment_pipe = pipeline(
            "sentiment-analysis",
            model="distilbert-base-uncased-finetuned-sst-2-english",
            device=-1,
            model_kwargs={"cache_dir": MODEL_CACHE_DIR},
        )
    return _sentiment_pipe


# ---------------------------------------------------------------------------
# Keyword extraction (TF-IDF style, no external libraries)
# ---------------------------------------------------------------------------

STOPWORDS = {
    "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your",
    "yours", "yourself", "he", "him", "his", "himself", "she", "her", "hers",
    "herself", "it", "its", "itself", "they", "them", "their", "theirs",
    "themselves", "what", "which", "who", "whom", "this", "that", "these",
    "those", "am", "is", "are", "was", "were", "be", "been", "being", "have",
    "has", "had", "having", "do", "does", "did", "doing", "a", "an", "the",
    "and", "but", "if", "or", "because", "as", "until", "while", "of", "at",
    "by", "for", "with", "about", "against", "between", "into", "through",
    "during", "before", "after", "above", "below", "to", "from", "up", "down",
    "in", "out", "on", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "s", "t",
    "can", "will", "just", "don", "should", "now", "d", "ll", "m", "o",
    "re", "ve", "y", "ain", "aren", "couldn", "didn", "doesn", "hadn",
    "hasn", "haven", "isn", "ma", "mightn", "mustn", "needn", "shan",
    "shouldn", "wasn", "weren", "won", "wouldn", "also", "like", "get",
    "got", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "would", "could", "may", "might", "shall", "even",
    "well", "back", "much", "many", "way", "time", "say", "said",
}


def extract_keywords(text: str, top_n: int = 8) -> list[str]:
    import re

    words = re.findall(r"\b[a-z]{3,}\b", text.lower())
    filtered = [w for w in words if w not in STOPWORDS]
    if not filtered:
        return []
    freq = Counter(filtered)
    return [word for word, _ in freq.most_common(top_n)]


# ---------------------------------------------------------------------------
# Core analysis helper
# ---------------------------------------------------------------------------


def _analyze_audio(audio_path: str) -> dict:
    whisper = get_whisper()
    sentiment_pipe = get_sentiment_pipe()

    # Transcribe
    segments_iter, info = whisper.transcribe(audio_path, beam_size=1)
    raw_segments = list(segments_iter)

    duration = info.duration if info.duration else 0.0
    language = info.language if info.language else "unknown"

    # Build segments with sentiment
    result_segments = []
    full_texts: list[str] = []

    for seg in raw_segments:
        text = seg.text.strip()
        if not text:
            continue
        full_texts.append(text)

        try:
            sent_result = sentiment_pipe(text[:512])[0]
            sentiment_label = sent_result["label"]
            sentiment_score = round(float(sent_result["score"]), 4)
        except Exception:
            sentiment_label = "NEUTRAL"
            sentiment_score = 0.5

        result_segments.append(
            {
                "start": round(float(seg.start), 2),
                "end": round(float(seg.end), 2),
                "text": text,
                "sentiment": sentiment_label,
                "sentiment_score": sentiment_score,
            }
        )

    transcript = " ".join(full_texts)
    word_count = len(transcript.split()) if transcript else 0
    speaking_rate_wpm = (
        round(word_count / (duration / 60)) if duration > 0 else 0
    )

    # Overall sentiment — average positive-score across segments
    if result_segments:
        pos_scores = []
        neg_scores = []
        for s in result_segments:
            if s["sentiment"] == "POSITIVE":
                pos_scores.append(s["sentiment_score"])
            else:
                neg_scores.append(s["sentiment_score"])

        avg_pos = sum(pos_scores) / len(pos_scores) if pos_scores else 0
        avg_neg = sum(neg_scores) / len(neg_scores) if neg_scores else 0

        if len(pos_scores) > len(neg_scores):
            overall_sentiment = "POSITIVE"
            overall_score = round(avg_pos, 4)
        elif len(neg_scores) > len(pos_scores):
            overall_sentiment = "NEGATIVE"
            overall_score = round(avg_neg, 4)
        else:
            overall_sentiment = "NEUTRAL"
            overall_score = round((avg_pos + avg_neg) / 2 if (avg_pos + avg_neg) else 0.5, 4)
    else:
        overall_sentiment = "NEUTRAL"
        overall_score = 0.5

    keywords = extract_keywords(transcript)

    return {
        "transcript": transcript,
        "language": language,
        "duration_seconds": round(duration, 2),
        "segments": result_segments,
        "overall_sentiment": overall_sentiment,
        "overall_sentiment_score": overall_score,
        "keywords": keywords,
        "word_count": word_count,
        "speaking_rate_wpm": speaking_rate_wpm,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    return {"status": "ok", "models": ["whisper-tiny", "distilbert-sentiment"]}


@app.post("/api/analyze")
async def analyze(audio: UploadFile = File(...)):
    suffix = os.path.splitext(audio.filename or "audio")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        result = _analyze_audio(tmp_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return result


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    suffix = os.path.splitext(audio.filename or "audio")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        whisper = get_whisper()
        segments_iter, info = whisper.transcribe(tmp_path, beam_size=1)
        texts = [seg.text.strip() for seg in segments_iter if seg.text.strip()]
        transcript = " ".join(texts)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return {
        "transcript": transcript,
        "language": info.language if info.language else "unknown",
        "duration_seconds": round(float(info.duration), 2) if info.duration else 0.0,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=11001)
