"use client";

export type AccountSplitSegment = {
  id: string;
  label: string;
  value: number;
  gradient: "main" | "sprout";
};

const GRADIENT_VAR: Record<AccountSplitSegment["gradient"], string> = {
  main: "var(--acc-main-grad)",
  sprout: "var(--acc-sprout-grad)",
};

const DOT_COLOR: Record<AccountSplitSegment["gradient"], string> = {
  main: "var(--acc-main-ink)",
  sprout: "var(--acc-sprout-ink)",
};

export function AccountSplitBar({ segments }: { segments: AccountSplitSegment[] }) {
  const nonZero = segments.filter((s) => s.value > 0);
  if (nonZero.length < 2) return null;

  const total = nonZero.reduce((sum, s) => sum + s.value, 0);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 3, height: 6, borderRadius: 999, overflow: "hidden" }}>
        {nonZero.map((s) => (
          <div key={s.id} style={{ flex: s.value, background: GRADIENT_VAR[s.gradient] }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        {nonZero.map((s) => {
          const pct = Math.round((s.value / total) * 100);
          return (
            <span
              key={s.id}
              style={{
                fontSize: 11,
                color: "var(--ink-2)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: DOT_COLOR[s.gradient],
                  display: "inline-block",
                }}
              />
              {s.label} · {pct}%
            </span>
          );
        })}
      </div>
    </div>
  );
}
