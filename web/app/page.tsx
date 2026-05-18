"use client";

import { useState, useRef, useCallback, DragEvent, ChangeEvent } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Segment {
  start: number;
  end: number;
  text: string;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  sentiment_score: number;
}

interface AnalysisResult {
  transcript: string;
  language: string;
  duration_seconds: number;
  segments: Segment[];
  overall_sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  overall_sentiment_score: number;
  keywords: string[];
  word_count: number;
  speaking_rate_wpm: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${String(Math.floor(parseFloat(sec))).padStart(2, "0")}.${sec.split(".")[1]}`;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function sentimentColor(s: string): string {
  if (s === "POSITIVE") return "var(--green)";
  if (s === "NEGATIVE") return "var(--red)";
  return "var(--amber)";
}

function sentimentBg(s: string): string {
  if (s === "POSITIVE") return "rgba(34,197,94,0.08)";
  if (s === "NEGATIVE") return "rgba(248,113,113,0.08)";
  return "rgba(251,191,36,0.08)";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span style={{ color: "var(--ink)", fontSize: 20, fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

function SentimentBadge({
  sentiment,
  score,
  large,
}: {
  sentiment: string;
  score: number;
  large?: boolean;
}) {
  const color = sentimentColor(sentiment);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: sentimentBg(sentiment),
        border: `1px solid ${color}40`,
        color,
        borderRadius: 20,
        padding: large ? "6px 16px" : "3px 10px",
        fontSize: large ? 14 : 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
      }}
    >
      <span
        style={{
          width: large ? 8 : 6,
          height: large ? 8 : 6,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      {sentiment}
      <span style={{ opacity: 0.8, fontWeight: 400 }}>
        {(score * 100).toFixed(0)}%
      </span>
    </span>
  );
}

function SentimentBar({ segments }: { segments: Segment[] }) {
  if (!segments.length) return null;
  const pos = segments.filter((s) => s.sentiment === "POSITIVE").length;
  const neg = segments.filter((s) => s.sentiment === "NEGATIVE").length;
  const neu = segments.filter((s) => s.sentiment === "NEUTRAL").length;
  const total = segments.length;

  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

  return (
    <div style={{ marginTop: 4 }}>
      <div
        style={{
          display: "flex",
          height: 8,
          borderRadius: 4,
          overflow: "hidden",
          gap: 2,
        }}
      >
        {pos > 0 && (
          <div
            title={`Positive: ${pct(pos)}`}
            style={{
              flex: pos,
              background: "var(--green)",
              borderRadius: "4px 0 0 4px",
            }}
          />
        )}
        {neu > 0 && (
          <div
            title={`Neutral: ${pct(neu)}`}
            style={{ flex: neu, background: "var(--amber)" }}
          />
        )}
        {neg > 0 && (
          <div
            title={`Negative: ${pct(neg)}`}
            style={{
              flex: neg,
              background: "var(--red)",
              borderRadius: "0 4px 4px 0",
            }}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 6,
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        <span style={{ color: "var(--green)" }}>
          ● Positive {pct(pos)}
        </span>
        <span style={{ color: "var(--amber)" }}>
          ● Neutral {pct(neu)}
        </span>
        <span style={{ color: "var(--red)" }}>
          ● Negative {pct(neg)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptedTypes = [".wav", ".mp3", ".m4a", ".ogg"];

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const analyze = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      fd.append("audio", file);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`${res.status}: ${detail}`);
      }
      const data: AnalysisResult = await res.json();
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        padding: "40px 24px 80px",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <p
          style={{
            color: "var(--accent)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            marginBottom: 8,
            fontWeight: 500,
          }}
        >
          Speech &amp; NLP Pipeline
        </p>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "var(--ink)",
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}
        >
          Audio Intelligence
        </h1>
        <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 13 }}>
          Upload audio → transcription · sentiment · keywords
        </p>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        style={{
          border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 12,
          padding: "48px 32px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver
            ? "rgba(167,139,250,0.04)"
            : file
            ? "rgba(167,139,250,0.03)"
            : "transparent",
          transition: "all 0.2s ease",
          marginBottom: 20,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptedTypes.join(",")}
          style={{ display: "none" }}
          onChange={onInputChange}
        />

        {/* Microphone SVG */}
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke={file ? "var(--accent)" : "var(--muted)"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ margin: "0 auto 16px", display: "block" }}
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>

        {file ? (
          <div>
            <p style={{ color: "var(--ink)", fontWeight: 600, fontSize: 15 }}>
              {file.name}
            </p>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
              {fmtBytes(file.size)} · click to change
            </p>
          </div>
        ) : (
          <div>
            <p style={{ color: "var(--ink)", fontSize: 15, fontWeight: 500 }}>
              Drop audio file here
            </p>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
              or click to browse · {acceptedTypes.join(" ")}
            </p>
          </div>
        )}
      </div>

      {/* Analyze button */}
      <button
        onClick={analyze}
        disabled={!file || loading}
        style={{
          width: "100%",
          padding: "14px 24px",
          background: file && !loading ? "var(--accent)" : "var(--panel)",
          color: file && !loading ? "#060a0f" : "var(--muted)",
          border: `1px solid ${file && !loading ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 700,
          fontFamily: "inherit",
          cursor: file && !loading ? "pointer" : "not-allowed",
          letterSpacing: "0.04em",
          transition: "all 0.2s ease",
          marginBottom: 32,
        }}
      >
        {loading ? "Analyzing…" : "Analyze Audio"}
      </button>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "20px 24px",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          {/* Pulsing spinner */}
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: "2px solid var(--border)",
              borderTopColor: "var(--accent)",
              animation: "spin 0.8s linear infinite",
              flexShrink: 0,
            }}
          />
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            Transcribing with Whisper tiny…
          </span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "16px 20px",
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.25)",
            borderRadius: 8,
            color: "var(--red)",
            fontSize: 13,
            marginBottom: 24,
          }}
        >
          Error: {error}
        </div>
      )}

      {/* Results panel */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Top metrics */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            <MetricCard
              label="Duration"
              value={fmtDuration(result.duration_seconds)}
            />
            <MetricCard label="Word Count" value={result.word_count} />
            <MetricCard
              label="Speaking Rate"
              value={`${result.speaking_rate_wpm} WPM`}
            />
            <MetricCard
              label="Language"
              value={result.language.toUpperCase()}
            />
          </div>

          {/* Overall sentiment */}
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "18px 20px",
            }}
          >
            <p
              style={{
                color: "var(--muted)",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 10,
              }}
            >
              Overall Sentiment
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <SentimentBadge
                sentiment={result.overall_sentiment}
                score={result.overall_sentiment_score}
                large
              />
              <SentimentBar segments={result.segments} />
            </div>
          </div>

          {/* Transcript */}
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "18px 20px",
            }}
          >
            <p
              style={{
                color: "var(--muted)",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 14,
              }}
            >
              Transcript · {result.segments.length} segment
              {result.segments.length !== 1 ? "s" : ""}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {result.segments.map((seg, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: sentimentBg(seg.sentiment),
                    borderLeft: `3px solid ${sentimentColor(seg.sentiment)}40`,
                  }}
                >
                  <span
                    style={{
                      color: "var(--muted)",
                      fontSize: 11,
                      whiteSpace: "nowrap",
                      paddingTop: 2,
                      minWidth: 90,
                      flexShrink: 0,
                    }}
                  >
                    {fmtTime(seg.start)}–{fmtTime(seg.end)}
                  </span>
                  <span style={{ color: "var(--ink)", fontSize: 13, flex: 1 }}>
                    {seg.text}
                  </span>
                  <SentimentBadge
                    sentiment={seg.sentiment}
                    score={seg.sentiment_score}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Keywords */}
          {result.keywords.length > 0 && (
            <div
              style={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "18px 20px",
              }}
            >
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 12,
                }}
              >
                Keywords
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {result.keywords.map((kw) => (
                  <span
                    key={kw}
                    style={{
                      background: "rgba(167,139,250,0.10)",
                      border: "1px solid rgba(167,139,250,0.25)",
                      color: "var(--accent)",
                      borderRadius: 20,
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
