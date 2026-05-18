import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audio Intelligence",
  description: "Speech & NLP Pipeline — transcription, sentiment, keywords",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
