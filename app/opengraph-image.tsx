import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

// Served at /opengraph-image and referenced automatically in the page's
// og:image / twitter:image tags. This is the card LinkedIn, Slack and X show.
export const alt = "Claude Workspace: branching conversations, memory and shared chats with Claude";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const features = ["Branching", "Memory", "Pinned snippets", "Shared chats", "Streaming"];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#030712",
          color: "#f9fafb",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          <div
            style={{
              width: "96px",
              height: "96px",
              borderRadius: "24px",
              background: "#f97316",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="56" height="56" viewBox="0 0 24 24">
              <path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z" fill="#ffffff" />
            </svg>
          </div>
          <div style={{ fontSize: "76px", fontWeight: 700, letterSpacing: "-2px" }}>{SITE_NAME}</div>
        </div>
        <div style={{ marginTop: "36px", fontSize: "36px", color: "#9ca3af", maxWidth: "960px", lineHeight: 1.3 }}>
          A smarter way to work with AI, built on the Claude API.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "48px" }}>
          {features.map((f) => (
            <div
              key={f}
              style={{
                display: "flex",
                fontSize: "26px",
                padding: "10px 24px",
                borderRadius: "999px",
                border: "2px solid #374151",
                color: "#e5e7eb",
              }}
            >
              {f}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
