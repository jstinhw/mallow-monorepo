"use client";
import { useEffect } from "react";
import { formatEther, type Address } from "viem";
import { AGENTS } from "@/lib/agent-plugins/agents";
import type { QueueItem } from "@/types/queue";
import { AgentBadge, Btn, Glyph, RiskChip, SoftCard } from "@/components/ui";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";
import { useWallet } from "@/hooks/useWallet";
import { useWalletHistory, relativeTime } from "@/hooks/useWalletHistory";
import { useTokenPortfolio } from "@/hooks/useTokenPortfolio";
import { useAgentPluginStatus } from "@/hooks/useAgentPluginStatus";
import { pluginSmartAccountAddress, pluginAutoInvestSnapshot } from "@/lib/agent-plugins/status";
import { DEFAULT_CHAIN_ID, txExplorerUrl } from "@/lib/constants/chains";
import { seedDefaultInstallations } from "@/lib/agent-plugins/seed";
import { PortfolioWidget } from "@/components/PortfolioWidget";
import type { HistoryEntry } from "@/app/api/wallet/history/route";

export function HomeScreen({
  onOpenItem,
  onGoQueue,
  onGoActivity,
  onGoSend,
  onGoTokens,
  onGoAutoInvest,
}: {
  onOpenItem: (id: string) => void;
  onGoQueue: () => void;
  onGoActivity: () => void;
  onGoSend: () => void;
  onGoTokens: () => void;
  onGoAutoInvest: () => void;
}) {
  const { pending } = useApprovalQueue();
  const { state } = useWallet();
  useEffect(() => {
    void seedDefaultInstallations();
  }, []);
  const address: Address | null =
    state.kind === "unlocked"
      ? state.wallet.address
      : state.kind === "locked"
        ? state.address
        : null;
  const autoInvestPlugin = useAgentPluginStatus("auto-invest", address);
  // The auto-invest agent's state lives in its plugin install record plus the
  // remote /status payload — that's the single source of truth for this screen.
  const pluginInstalled = !!autoInvestPlugin.installation;
  const investmentAgentAddress: Address | null = pluginSmartAccountAddress(
    autoInvestPlugin.installation,
  );
  const autoInvestSnapshot = pluginAutoInvestSnapshot(autoInvestPlugin.status);
  const pluginStatusReady = autoInvestSnapshot !== null || !!autoInvestPlugin.error;
  const autoInvestLoading = autoInvestPlugin.loading || (pluginInstalled && !pluginStatusReady);
  const { holdings, totalUsdValue, loading } = useTokenPortfolio(address);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {address && <AccountAddress address={address} />}

        <PortfolioWidget
          holdings={holdings}
          totalUsdValue={totalUsdValue}
          loading={loading}
          investmentAgentAddress={investmentAgentAddress}
          autoInvest={autoInvestSnapshot}
          onSend={onGoSend}
          onManage={onGoTokens}
          onGoAutoInvest={onGoAutoInvest}
        />

        <SoftCard padding={0}>
          <div
            style={{
              padding: "20px 22px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink-3)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                Waiting on you
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 28,
                  fontWeight: 400,
                  letterSpacing: "-0.01em",
                  marginTop: 4,
                }}
              >
                {pending.length} decision{pending.length === 1 ? "" : "s"}
              </div>
            </div>
            <Btn kind="ghost" size="sm" onClick={onGoQueue}>
              See all
            </Btn>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {pending.slice(0, 3).map((q, i) => (
              <QueueRow key={q.id} item={q} onOpen={() => onOpenItem(q.id)} divider={i > 0} />
            ))}
            {pending.length === 0 && (
              <div
                style={{ padding: 32, textAlign: "center", color: "var(--ink-3)", fontSize: 14 }}
              >
                No pending decisions.
              </div>
            )}
          </div>
        </SoftCard>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SoftCard padding={22}>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-3)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Agents at work
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
            {Object.values(AGENTS).map((a) => {
              const has = pending.find((p) => p.agent === a.id);
              const isYield = a.id === "yield";
              const isYieldLoading = isYield && autoInvestLoading;
              const isLiveYield = isYield && !!autoInvestSnapshot && !!investmentAgentAddress;
              const yieldEnabled = isLiveYield && (autoInvestSnapshot?.enabled ?? true);
              const yieldProtocol = autoInvestSnapshot?.protocolId ?? null;
              const status = has
                ? "awaiting you"
                : isYieldLoading
                  ? "loading"
                  : isLiveYield && yieldEnabled
                    ? "watching"
                    : isLiveYield
                      ? "paused"
                      : a.always
                        ? "watching"
                        : "idle";
              const lastAction = isYieldLoading
                ? "Loading…"
                : isLiveYield
                  ? yieldEnabled
                    ? yieldProtocol
                      ? `On ${yieldProtocol === "aave" ? "Aave V3 USDC" : "Morpho USDC"}`
                      : "Waiting for first deposit"
                    : "Paused"
                  : a.always
                    ? "Active · waiting for tx"
                    : "Not connected";
              const clickable = a.id === "yield";
              return (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    cursor: clickable ? "pointer" : "default",
                    padding: clickable ? "4px 6px" : 0,
                    margin: clickable ? "-4px -6px" : 0,
                    borderRadius: 10,
                    transition: "background 140ms ease",
                  }}
                  onClick={clickable ? onGoAutoInvest : undefined}
                  onMouseEnter={
                    clickable
                      ? (e) => (e.currentTarget.style.background = "var(--surface-2)")
                      : undefined
                  }
                  onMouseLeave={
                    clickable
                      ? (e) => (e.currentTarget.style.background = "transparent")
                      : undefined
                  }
                >
                  <AgentBadge agentId={a.id} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</span>
                      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>· {a.role}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>
                      {lastAction}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "5px 10px",
                      borderRadius: 999,
                      background:
                        status === "awaiting you"
                          ? "var(--c-med)"
                          : status === "watching"
                            ? "var(--c-low)"
                            : status === "paused"
                              ? "var(--c-med-tint)"
                              : "var(--surface-2)",
                      color:
                        status === "awaiting you"
                          ? "var(--c-med-ink)"
                          : status === "watching"
                            ? "var(--c-low-ink)"
                            : status === "paused"
                              ? "var(--c-med-ink)"
                              : "var(--ink-3)",
                      whiteSpace: "nowrap",
                      opacity: status === "loading" ? 0.6 : 1,
                    }}
                  >
                    {status === "awaiting you" && "● "}
                    {status}
                  </span>
                </div>
              );
            })}
          </div>
        </SoftCard>

        <SoftCard padding={22}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-3)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Recent
            </div>
            <Btn kind="ghost" size="sm" onClick={onGoActivity}>
              History
            </Btn>
          </div>
          <RecentLive address={address} />
        </SoftCard>
      </div>
    </div>
  );
}

function AccountAddress({ address }: { address: Address }) {
  return (
    <SoftCard padding={18}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            background: "var(--surface-2)",
            color: "var(--ink-2)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Glyph name="wallet" size={17} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Account
          </div>
          <div
            title={address}
            style={{
              marginTop: 3,
              color: "var(--ink-1)",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {address}
          </div>
        </div>
      </div>
    </SoftCard>
  );
}

function RecentLive({ address }: { address: Address | null }) {
  const { entries, loading, error } = useWalletHistory(address, 3);
  if (loading) {
    return (
      <div style={{ padding: "16px 0", color: "var(--ink-3)", fontSize: 13 }}>
        Fetching from Etherscan…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: "16px 0", color: "var(--c-crit-ink)", fontSize: 13 }}>{error}</div>
    );
  }
  if (!entries || entries.length === 0) {
    return (
      <div style={{ padding: "20px 0 4px", color: "var(--ink-3)", fontSize: 13 }}>
        No transactions yet.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
      {entries.map((e) => (
        <HistoryRow key={e.hash} entry={e} />
      ))}
    </div>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const eth = formatEther(BigInt(entry.value));
  const arrow = entry.direction === "in" ? "+" : entry.direction === "out" ? "−" : "↻";
  const color = entry.isError
    ? "var(--c-crit-ink)"
    : entry.direction === "in"
      ? "var(--c-pos)"
      : "var(--ink-1)";
  return (
    <a
      href={txExplorerUrl(DEFAULT_CHAIN_ID, entry.hash)}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: entry.direction === "in" ? "var(--c-low-tint)" : "var(--surface-2)",
          color: entry.direction === "in" ? "var(--c-low-ink)" : "var(--ink-2)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Glyph name={entry.direction === "in" ? "plus" : "send"} size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "var(--font-mono)",
            color,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {arrow} {Number(eth).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH
          {entry.isError && <span style={{ marginLeft: 6, fontSize: 10 }}>· reverted</span>}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
          {relativeTime(entry.timestamp)}
        </div>
      </div>
      <Glyph name="arrow" size={14} />
    </a>
  );
}

function QueueRow({
  item,
  onOpen,
  divider = false,
}: {
  item: QueueItem;
  onOpen: () => void;
  divider?: boolean;
}) {
  const a = AGENTS[item.agent] ?? { name: "Guardian" };
  return (
    <button
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 22px",
        background: "transparent",
        borderStyle: "none",
        borderTopStyle: "solid",
        borderTopWidth: divider ? 1 : 0,
        borderTopColor: "var(--surface-edge)",
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background 140ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <AgentBadge agentId={item.agent} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</span>
          <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
            · {item.proposedAt}
          </span>
        </div>
        <div
          style={{
            fontSize: 14,
            color: "var(--ink-1)",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.intent}
        </div>
      </div>
      <RiskChip risk={item.risk} size="sm" />
      <Glyph name="arrow" size={16} />
    </button>
  );
}
