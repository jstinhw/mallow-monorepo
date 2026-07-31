"use client";
import { formatEther, type Address } from "viem";
import { AgentBadge, Glyph, SoftCard } from "@/components/ui";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";
import { useWallet } from "@/hooks/useWallet";
import { useWalletHistory, relativeTime } from "@/hooks/useWalletHistory";
import { DEFAULT_CHAIN_ID, txExplorerUrl } from "@/lib/constants/chains";

export function ActivityScreen() {
  const { queue } = useApprovalQueue();
  const { state } = useWallet();
  const address: Address | null =
    state.kind === "unlocked"
      ? state.wallet.address
      : state.kind === "locked"
        ? state.address
        : null;
  const { entries, loading, error } = useWalletHistory(address, 20);
  const settled = queue.filter((q) => q.state === "approved" || q.state === "rejected");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: 0 }}>
        On-chain history for this wallet (Arbitrum, via Etherscan), plus your recent decisions.
      </p>

      {settled.length > 0 && (
        <SoftCard padding={0}>
          <div
            style={{
              padding: "14px 22px",
              borderBottom: "1px solid var(--surface-edge)",
              fontSize: 12,
              color: "var(--ink-3)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Recent decisions
          </div>
          {settled.map((a, i) => (
            <div
              key={a.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto",
                alignItems: "center",
                gap: 16,
                padding: "14px 22px",
                borderTop: i > 0 ? "1px solid var(--surface-edge)" : "none",
              }}
            >
              <AgentBadge agentId={a.agent} size={32} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{a.intent}</div>
              </div>
              <span style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                {a.proposedAt}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: a.state === "approved" ? "var(--c-low)" : "var(--c-info)",
                  color: a.state === "approved" ? "var(--c-low-ink)" : "var(--c-info-ink)",
                }}
              >
                {a.state === "approved" ? "approved" : "declined"}
              </span>
            </div>
          ))}
        </SoftCard>
      )}

      <SoftCard padding={0}>
        <div
          style={{
            padding: "14px 22px",
            borderBottom: "1px solid var(--surface-edge)",
            fontSize: 12,
            color: "var(--ink-3)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          On-chain
        </div>
        {loading && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            Fetching from Etherscan…
          </div>
        )}
        {error && (
          <div
            style={{ padding: 32, textAlign: "center", color: "var(--c-crit-ink)", fontSize: 13 }}
          >
            {error}
          </div>
        )}
        {!loading && !error && entries && entries.length === 0 && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>
            No transactions yet. Fund the wallet from a faucet to get started.
          </div>
        )}
        {entries &&
          entries.map((e, i) => {
            const eth = formatEther(BigInt(e.value));
            const arrow = e.direction === "in" ? "+" : e.direction === "out" ? "−" : "↻";
            const counterparty = e.direction === "in" ? e.from : e.to;
            return (
              <a
                key={e.hash}
                href={txExplorerUrl(DEFAULT_CHAIN_ID, e.hash)}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto auto",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 22px",
                  borderTop: i > 0 ? "1px solid var(--surface-edge)" : "none",
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background 120ms ease",
                }}
                onMouseEnter={(el) => (el.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(el) => (el.currentTarget.style.background = "transparent")}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    background: e.direction === "in" ? "var(--c-low-tint)" : "var(--surface-2)",
                    color: e.direction === "in" ? "var(--c-low-ink)" : "var(--ink-2)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Glyph name={e.direction === "in" ? "plus" : "send"} size={14} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, fontFamily: "var(--font-mono)" }}>
                    {arrow} {Number(eth).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
                    ETH
                    {e.isError && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: "var(--c-crit-ink)" }}>
                        · reverted
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-3)",
                      fontFamily: "var(--font-mono)",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.direction === "in" ? "from " : "to "}{" "}
                    {counterparty ? `${counterparty.slice(0, 6)}…${counterparty.slice(-4)}` : "—"}
                  </div>
                </div>
                <span
                  style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}
                >
                  {relativeTime(e.timestamp)}
                </span>
                <Glyph name="arrow" size={14} />
              </a>
            );
          })}
      </SoftCard>
    </div>
  );
}
