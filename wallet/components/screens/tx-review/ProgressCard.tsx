"use client";
import type { LiveStage, LiveStatus } from "@/types/queue";
import { SoftCard, Glyph } from "@/components/ui";
import { ActionList } from "./ActionList";
import { PlanSummary } from "./PlanSummary";
import { LiveDraft } from "./LiveDraft";

const STAGES: LiveStage[] = ["plan", "analyze", "llm", "verdict"];

const STAGE_LABEL: Record<LiveStage, string> = {
  plan: "Reading your transaction",
  analyze: "Running the checks",
  llm: "Drafting the verdict",
  verdict: "Finalizing",
  ready: "Ready",
  error: "Error",
};

export function ProgressCard({ live }: { live: LiveStatus }) {
  const currentIdx = STAGES.indexOf(live.stage);
  return (
    <SoftCard padding={20}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {STAGES.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={s} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <StageHeader stage={s} active={active} done={done} dim={i > currentIdx} />
              {s === "plan" &&
                active &&
                (live.planActions && live.planActions.length > 0 ? (
                  <PlanSummary
                    reasoning={live.planReasoning}
                    planActions={live.planActions}
                    liveActions={[]}
                    roundIntents={undefined}
                  />
                ) : (
                  <SubLine text="Choosing which checks to run…" />
                ))}
              {s === "analyze" &&
                (active || done) &&
                (live.planActions && live.planActions.length > 0 ? (
                  <PlanSummary
                    reasoning={undefined}
                    planActions={live.planActions}
                    liveActions={live.actions}
                    roundIntents={live.roundIntents}
                  />
                ) : (
                  <ActionList actions={live.actions} dim={done} roundIntents={live.roundIntents} />
                ))}
              {s === "llm" && (active || done) && (
                <LiveDraft summary={live.draftSummary} reasoning={live.draftReasoning} />
              )}
            </div>
          );
        })}
      </div>
    </SoftCard>
  );
}

function StageHeader({
  stage,
  active,
  done,
  dim,
}: {
  stage: LiveStage;
  active: boolean;
  done: boolean;
  dim: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        color: dim ? "var(--ink-3)" : "var(--ink-1)",
        fontWeight: active ? 600 : 400,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: done ? "var(--c-low)" : active ? "var(--accent-tint)" : "var(--surface-2)",
          color: done ? "var(--c-low-ink)" : active ? "var(--accent-ink)" : "var(--ink-3)",
          flexShrink: 0,
        }}
      >
        {done ? (
          <Glyph name="check" size={11} stroke={2.4} />
        ) : active ? (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "currentColor",
              animation: "ml-pulse 1.4s ease-out infinite",
            }}
          />
        ) : (
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: 999,
              background: "currentColor",
              opacity: 0.4,
            }}
          />
        )}
      </span>
      <span>{STAGE_LABEL[stage]}</span>
    </div>
  );
}

function SubLine({ text }: { text: string }) {
  return (
    <div
      style={{
        marginLeft: 28,
        fontSize: 12,
        color: "var(--ink-3)",
        fontStyle: "italic",
        lineHeight: 1.4,
      }}
    >
      {text}
    </div>
  );
}
