"use client";
import { AGENTS } from "@/lib/agent-plugins/agents";
import { AgentBadge, Btn, RiskChip } from "@/components/ui";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";

export function ToastStack({ onOpen }: { onOpen: (id: string) => void }) {
  const { toasts, dismissToast } = useApprovalQueue();
  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 50,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 12,
        maxWidth: 380,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => {
        const a = AGENTS[t.agent] ?? { name: "Guardian" };
        return (
          <div
            key={t.id}
            style={{
              background: "var(--surface-1)",
              borderRadius: 18,
              boxShadow: "var(--shadow-lift)",
              border: "1px solid var(--surface-edge)",
              padding: 14,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              pointerEvents: "auto",
              animation: "ml-toast-in 240ms ease-out",
            }}
          >
            <AgentBadge agentId={t.agent} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-3)",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  <strong style={{ color: "var(--ink-1)" }}>{a.name}</strong> proposes
                </span>
                <RiskChip risk={t.risk} size="sm" />
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink-1)",
                  marginTop: 4,
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {t.intent}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <Btn kind="soft" size="sm" onClick={() => onOpen(t.id)}>
                  Review
                </Btn>
                <Btn kind="ghost" size="sm" onClick={() => dismissToast(t.id)}>
                  Later
                </Btn>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
