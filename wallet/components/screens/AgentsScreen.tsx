"use client";
import { AGENTS } from "@/lib/agent-plugins/agents";
import { AgentBadge, Btn, SoftCard } from "@/components/ui";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";
import { useAgentPluginStatus } from "@/hooks/useAgentPluginStatus";
import { useUninstallAgent } from "@/hooks/useUninstallAgent";
import { useWallet } from "@/hooks/useWallet";
import { getAgentPlugin } from "@/lib/agent-plugins/registry";
import { fetchAgentRequest } from "@/lib/agent-plugins/client";
import { useState } from "react";

type Props = {
  onOpenAutoInvest: () => void;
  onOpenInboxItem: (id: string) => void;
};

export function AgentsScreen({ onOpenAutoInvest, onOpenInboxItem }: Props) {
  const { pending, submitAgentInstallReview } = useApprovalQueue();
  const wallet = useWallet();
  const address =
    wallet.state.kind === "unlocked"
      ? wallet.state.wallet.address
      : wallet.state.kind === "locked"
        ? wallet.state.address
        : null;
  const autoInvestPlugin = useAgentPluginStatus("auto-invest", address);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState(false);
  const {
    uninstalling,
    error: uninstallError,
    result: uninstallResult,
    uninstall,
    reset: resetUninstall,
  } = useUninstallAgent(autoInvestPlugin.installation, autoInvestPlugin.refresh);

  const requestGuardian = async () => {
    if (wallet.state.kind !== "unlocked") return;
    setRequesting(true);
    setRequestError(null);
    try {
      const mallowMainWallet = wallet.state.wallet.address;
      const plugin = getAgentPlugin("auto-invest");
      const request = await fetchAgentRequest(plugin.serviceUrl, mallowMainWallet);
      const id = submitAgentInstallReview({
        pluginId: plugin.id,
        serviceUrl: plugin.serviceUrl,
        mallowMainWallet,
        agentKey: plugin.agentKey,
        request,
      });
      onOpenInboxItem(id);
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : "Could not request agent install.");
    } finally {
      setRequesting(false);
    }
  };

  const uninstallAutoInvest = async () => {
    if (await uninstall()) setUninstallConfirm(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p style={{ color: "var(--ink-2)", fontSize: 14, margin: 0 }}>
        Permissions, recent work, and what they&apos;re allowed to spend.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {Object.values(AGENTS).map((a) => {
          const mine = pending.filter((q) => q.agent === a.id);
          const policy =
            a.id === "guardian"
              ? { caps: "—", venues: "all transactions", note: "Cannot move funds; only reviews." }
              : {
                  caps: "$5,000 / week",
                  venues: "Aave v3, Morpho",
                  note: "Min APY 3.5%. Withdraws if rate drops.",
                };
          const isSprout = a.id === "yield";
          const installed = isSprout && !!autoInvestPlugin.installation;
          return (
            <SoftCard key={a.id} padding={22}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <AgentBadge agentId={a.id} size={48} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 22,
                        fontWeight: 400,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {a.name}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{a.role}</span>
                  </div>
                  <div
                    style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.5 }}
                  >
                    {a.blurb}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: "5px 10px",
                    borderRadius: 999,
                    fontWeight: 600,
                    background: a.always ? "var(--c-low)" : "var(--surface-2)",
                    color: a.always ? "var(--c-low-ink)" : "var(--ink-2)",
                  }}
                >
                  {a.always ? "always on" : "active"}
                </span>
              </div>
              <div
                style={{
                  marginTop: 16,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "8px 14px",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--ink-3)" }}>Spend cap</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-1)" }}>
                  {policy.caps}
                </span>
                <span style={{ color: "var(--ink-3)" }}>Allowed venues</span>
                <span style={{ color: "var(--ink-1)" }}>{policy.venues}</span>
                <span style={{ color: "var(--ink-3)" }}>Notes</span>
                <span style={{ color: "var(--ink-2)" }}>{policy.note}</span>
              </div>
              {mine.length > 0 && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "10px 12px",
                    background: "var(--c-med-tint)",
                    borderRadius: 12,
                    fontSize: 13,
                    color: "var(--c-med-ink)",
                  }}
                >
                  ● {mine.length} decision{mine.length === 1 ? "" : "s"} waiting from {a.name}
                </div>
              )}
              <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                {isSprout ? (
                  installed ? (
                    <>
                      <Btn kind="primary" size="sm" icon="leaf" onClick={onOpenAutoInvest}>
                        Open Auto-Invest
                      </Btn>
                      {autoInvestPlugin.installation &&
                        (uninstallConfirm ? (
                          <>
                            <Btn
                              kind="ghost"
                              size="sm"
                              onClick={() => void uninstallAutoInvest()}
                              disabled={uninstalling}
                            >
                              {uninstalling ? "Uninstalling…" : "Confirm uninstall"}
                            </Btn>
                            <Btn
                              kind="ghost"
                              size="sm"
                              onClick={() => setUninstallConfirm(false)}
                              disabled={uninstalling}
                            >
                              Cancel
                            </Btn>
                          </>
                        ) : (
                          <Btn
                            kind="ghost"
                            size="sm"
                            onClick={() => {
                              resetUninstall();
                              setUninstallConfirm(true);
                            }}
                          >
                            Uninstall
                          </Btn>
                        ))}
                    </>
                  ) : (
                    <Btn
                      kind="primary"
                      size="sm"
                      icon="spark"
                      onClick={() => void requestGuardian()}
                      disabled={requesting || wallet.state.kind !== "unlocked"}
                    >
                      {requesting ? "Requesting Guardian…" : "Enable Auto-Invest"}
                    </Btn>
                  )
                ) : (
                  <>
                    <Btn kind="soft" size="sm">
                      Edit policy
                    </Btn>
                    {!a.always && (
                      <Btn kind="ghost" size="sm">
                        Pause
                      </Btn>
                    )}
                  </>
                )}
              </div>
              {isSprout && requestError && (
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--c-crit-ink)" }}>
                  {requestError}
                </div>
              )}
              {isSprout &&
                autoInvestPlugin.installation &&
                uninstallConfirm &&
                !uninstalling &&
                !uninstallError && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-2)" }}>
                    This withdraws all managed USDC and returns it to your main wallet.
                  </div>
                )}
              {isSprout && uninstallError && (
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--c-crit-ink)" }}>
                  {uninstallError}
                </div>
              )}
              {isSprout && uninstallResult && (
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-2)" }}>
                  {uninstallResult}
                </div>
              )}
            </SoftCard>
          );
        })}
      </div>
    </div>
  );
}
