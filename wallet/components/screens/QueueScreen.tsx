"use client";
import { AGENTS } from "@/lib/agent-plugins/agents";
import type { QueueItem } from "@/types/queue";
import { AgentBadge, Glyph, RiskChip, SoftCard } from "@/components/ui";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";

export function QueueScreen({ onOpenItem }: { onOpenItem: (id: string) => void }) {
  const { pending } = useApprovalQueue();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: 0 }}>
        Decisions your agents need from you. Skim, dive in, snooze.
      </p>
      <SoftCard padding={0}>
        {pending.map((q, i) => (
          <QueueInboxRow key={q.id} item={q} onOpen={() => onOpenItem(q.id)} divider={i > 0} />
        ))}
        {pending.length === 0 && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>
            Inbox zero ✿
          </div>
        )}
      </SoftCard>
    </div>
  );
}

function QueueInboxRow({
  item,
  onOpen,
  divider,
}: {
  item: QueueItem;
  onOpen: () => void;
  divider: boolean;
}) {
  const a = AGENTS[item.agent] ?? { name: "Guardian", role: "Security" };
  const firstDiff = item.assetDiff[0];
  const diffStr = firstDiff
    ? typeof firstDiff.delta === "string"
      ? `${firstDiff.delta} ${firstDiff.sym}`
      : `${firstDiff.delta > 0 ? "+" : "−"}${Math.abs(firstDiff.delta).toLocaleString()} ${firstDiff.sym}`
    : "";
  return (
    <button
      onClick={onOpen}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto",
        alignItems: "center",
        gap: 16,
        padding: "20px 24px",
        background: "transparent",
        borderStyle: "none",
        borderTopStyle: "solid",
        borderTopWidth: divider ? 1 : 0,
        borderTopColor: "var(--surface-edge)",
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <AgentBadge agentId={item.agent} size={44} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{a.name}</span>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{a.role}</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              fontFamily: "var(--font-mono)",
              marginLeft: "auto",
              paddingLeft: 12,
            }}
          >
            {item.proposedAt}
          </span>
        </div>
        <div style={{ fontSize: 16, color: "var(--ink-1)", marginTop: 4, fontWeight: 500 }}>
          {item.intent}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.4 }}>
          {item.why}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        {item.live && item.live.stage !== "ready" && item.live.stage !== "error" ? (
          <LiveTag />
        ) : item.live?.stage === "error" ? (
          <ErrorTag />
        ) : (
          <RiskChip risk={item.risk} size="sm" />
        )}
        {diffStr && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-2)" }}>
            {diffStr}
          </span>
        )}
      </div>
      <Glyph name="arrow" size={16} />
    </button>
  );
}

function LiveTag() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: "var(--accent-tint)",
        color: "var(--accent-ink)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 999,
          background: "currentColor",
          animation: "ml-pulse 1.4s ease-out infinite",
        }}
      />
      Checking
    </span>
  );
}

function ErrorTag() {
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        background: "var(--c-crit)",
        color: "var(--c-crit-ink)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
      }}
    >
      Error
    </span>
  );
}
