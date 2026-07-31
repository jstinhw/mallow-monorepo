"use client";
import type { GuardianAction } from "@/types/guardian";
import type { LiveAction } from "@/types/queue";
import { ActionList } from "./ActionList";

const PLAN_LABEL: Record<GuardianAction, string> = {
  decode_calldata: "Decoded the call",
  get_contract_info: "Looked up contract",
  simulate_transaction: "Simulated transaction",
  lookup_sourcify_signature: "Looked up signature",
};

export function PlanSummary({
  reasoning,
  planActions,
  liveActions,
  roundIntents,
}: {
  reasoning?: string;
  planActions: GuardianAction[];
  liveActions: LiveAction[];
  roundIntents?: Record<number, string>;
}) {
  const liveByLabel = new Map<string, LiveAction>();
  for (const a of liveActions) liveByLabel.set(a.label, a);

  const merged: LiveAction[] = [];
  let placeholderId = -1;
  for (const action of planActions) {
    const label = PLAN_LABEL[action];
    const live = liveByLabel.get(label);
    if (live) {
      merged.push(live);
      liveByLabel.delete(label);
    } else {
      merged.push({
        callId: `plan-${placeholderId--}`,
        round: -1,
        label,
        status: "running",
      });
    }
  }
  for (const remaining of liveByLabel.values()) merged.push(remaining);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {reasoning && (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.45,
            paddingLeft: 28,
          }}
        >
          {reasoning}
        </div>
      )}
      <PlannedList actions={merged} roundIntents={roundIntents} />
    </div>
  );
}

function PlannedList({
  actions,
  roundIntents,
}: {
  actions: LiveAction[];
  roundIntents?: Record<number, string>;
}) {
  const placeholders = actions.filter((a) => a.callId.startsWith("plan-"));
  const realActions = actions.filter((a) => !a.callId.startsWith("plan-"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {placeholders.length > 0 && (
        <div style={{ opacity: 0.45 }}>
          <ActionList actions={placeholders} dim={false} />
        </div>
      )}
      {realActions.length > 0 && (
        <ActionList actions={realActions} dim={false} roundIntents={roundIntents} />
      )}
    </div>
  );
}
