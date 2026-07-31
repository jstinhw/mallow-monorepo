"use client";
import type { LiveAction } from "@/types/queue";
import { Glyph } from "@/components/ui";

export function ActionList({
  actions,
  dim,
  roundIntents,
}: {
  actions: LiveAction[];
  dim: boolean;
  roundIntents?: Record<number, string>;
}) {
  const byRound = new Map<number, LiveAction[]>();
  for (const a of actions) {
    const list = byRound.get(a.round) ?? [];
    list.push(a);
    byRound.set(a.round, list);
  }
  const orderedRounds = [...byRound.keys()].sort((a, b) => a - b);

  return (
    <div
      style={{
        marginLeft: 28,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: dim ? 0.5 : 1,
      }}
    >
      {orderedRounds.map((round) => (
        <div key={round} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {roundIntents?.[round] && (
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                fontStyle: "italic",
                lineHeight: 1.4,
                paddingLeft: 24,
              }}
            >
              {roundIntents[round]}
            </div>
          )}
          {byRound.get(round)!.map((a) => (
            <Row key={a.callId} action={a} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Row({ action: a }: { action: LiveAction }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 2,
          background:
            a.status === "ok"
              ? "var(--c-low-tint)"
              : a.status === "error"
                ? "var(--c-crit-tint)"
                : "var(--accent-tint)",
          color:
            a.status === "ok"
              ? "var(--c-low-ink)"
              : a.status === "error"
                ? "var(--c-crit-ink)"
                : "var(--accent-ink)",
          flexShrink: 0,
        }}
      >
        {a.status === "ok" ? (
          <Glyph name="check" size={10} stroke={2.6} />
        ) : a.status === "error" ? (
          <Glyph name="x" size={10} stroke={2.6} />
        ) : (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: "currentColor",
              animation: "ml-pulse 1.4s ease-out infinite",
            }}
          />
        )}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}>{a.label}</div>
        {a.summary && (
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              marginTop: 2,
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {a.summary}
          </div>
        )}
      </div>
      {a.durationMs !== undefined && (
        <span
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap",
            marginTop: 2,
          }}
        >
          {a.durationMs}ms
        </span>
      )}
    </div>
  );
}
