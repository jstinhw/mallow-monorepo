"use client";

export function LiveDraft({ summary, reasoning }: { summary?: string; reasoning?: string }) {
  const hasContent = (summary && summary.length > 0) || (reasoning && reasoning.length > 0);

  return (
    <div
      style={{
        marginLeft: 28,
        padding: 14,
        borderRadius: 14,
        background: "var(--surface-2)",
        border: "1px solid var(--surface-edge)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        Drafting
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: "currentColor",
            animation: "ml-pulse 1.4s ease-out infinite",
          }}
        />
      </div>
      {!hasContent && (
        <div style={{ fontSize: 13, color: "var(--ink-3)", fontStyle: "italic" }}>Writing…</div>
      )}
      {summary && (
        <div
          style={{
            fontSize: 16,
            color: "var(--ink-1)",
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
          }}
        >
          {summary}
          <Cursor />
        </div>
      )}
      {reasoning && (
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-2)",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          {reasoning}
          <Cursor />
        </div>
      )}
    </div>
  );
}

function Cursor() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 13,
        marginLeft: 2,
        verticalAlign: "text-bottom",
        background: "currentColor",
        animation: "ml-pulse 1.0s ease-in-out infinite",
      }}
    />
  );
}
