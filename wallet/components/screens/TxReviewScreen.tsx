"use client";
import { useState } from "react";
import { AGENTS } from "@/lib/agent-plugins/agents";
import type { LiveStage, QueueItem } from "@/types/queue";
import { ProgressCard } from "./tx-review/ProgressCard";
import { Prose } from "./tx-review/Prose";
import { AgentBadge, AssetDiff, Btn, Glyph, RiskChip, SoftCard } from "@/components/ui";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";
import { useWallet } from "@/hooks/useWallet";
import { postAgentInstall, postActionResults } from "@/lib/agent-plugins/client";
import { saveAgentInstallation } from "@/lib/agent-plugins/store";
import { executeAgentRequestActions } from "@/lib/agent-plugins/actions";
import { DEFAULT_CHAIN_ID, txExplorerUrl } from "@/lib/constants/chains";
import { safeHost } from "@/lib/walletconnect/requests";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transition: "transform 160ms ease",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
      }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function TxReviewScreen({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const { approve, reject, signLive, signSignatureRequest } = useApprovalQueue();
  const { state } = useWallet();
  const wallet = state.kind === "unlocked" ? state.wallet : null;

  const [confirmText, setConfirmText] = useState("");
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [checksOpenManual, setChecksOpenManual] = useState<boolean | null>(null);
  const a = AGENTS[item.agent] ?? { name: "You", role: "Self-initiated" };
  const policy = item.policyReview;
  const agentInstall = item.agentInstall;
  const isPolicyReview = !!policy;
  const isAgentInstall = !!agentInstall;
  const policyStageReady = !isPolicyReview || policy.stage === "ready";
  const policyStageError = isPolicyReview && policy.stage === "error";
  const policyWaiting = isPolicyReview && !policyStageReady && !policyStageError;
  const live = item.live;
  const isLive = !!live;
  const sig = item.signatureReview;
  const isSignature = !!sig;
  // A signature request may or may not carry a Guardian review. An
  // eth_signTypedData_v4 with a verifyingContract runs Guardian against the
  // verifying contract (item.live is set) and must behave like a live review:
  // show streaming progress and gate readiness on the Guardian stage. A
  // signature with no review (personal_sign, or typed data without a
  // verifyingContract) has no live status and is ready immediately — handled
  // by the `!isLive` fallthrough below.
  const stageReady = isAgentInstall
    ? true
    : isPolicyReview
      ? policyStageReady
      : !isLive || live!.stage === "ready";
  const stageError = isAgentInstall
    ? false
    : isPolicyReview
      ? policyStageError
      : isLive && live!.stage === "error";

  const checksOpen = checksOpenManual ?? (stageReady && item.risk !== "info");

  const waitingForReview = isAgentInstall
    ? false
    : isPolicyReview
      ? policyWaiting
      : isLive && !stageReady && !stageError;

  const canApprove =
    stageReady && !stageError && (!item.requiresTyping || confirmText === "I UNDERSTAND");
  const approveLabel = signing
    ? isPolicyReview || isAgentInstall
      ? "Installing…"
      : "Approving…"
    : waitingForReview
      ? "Waiting for Guardian"
      : stageError
        ? "Guardian failed"
        : item.risk === "critical"
          ? "Approve anyway"
          : isPolicyReview || isAgentInstall
            ? "Approve & install"
            : isLive
              ? "Approve & sign"
              : "Approve";

  const sign = async () => {
    setSigning(true);
    setSignError(null);
    try {
      if (isAgentInstall && agentInstall) {
        if (!wallet) throw new Error("Wallet locked");
        const txns = await executeAgentRequestActions({
          request: agentInstall.request,
          wallet,
        });
        const installed = await postAgentInstall(agentInstall.serviceUrl, {
          account: agentInstall.mallowMainWallet,
          txns,
        });
        await saveAgentInstallation({
          pluginId: agentInstall.pluginId,
          serviceUrl: agentInstall.serviceUrl,
          mallowMainWallet: agentInstall.mallowMainWallet,
          agentId: installed.agentId,
          request: agentInstall.request,
          installedAt: Date.now(),
        });
        approve(item.id);
      } else if (isPolicyReview && policy) {
        if (!wallet) throw new Error("Wallet locked");
        const txns = await executeAgentRequestActions({ request: policy.request, wallet });
        await postActionResults(policy.serviceUrl, {
          account: wallet.account.address,
          txns,
        });
        approve(item.id);
      } else if (isSignature && sig) {
        // Must precede the isLive branch: an eth_signTypedData_v4 review also
        // sets item.live, but it is signed (typed data), never broadcast.
        if (!wallet) throw new Error("Wallet locked");
        await signSignatureRequest(item.id, wallet);
      } else if (isLive) {
        if (!wallet) throw new Error("Wallet locked");
        await signLive(item.id, wallet);
      } else {
        approve(item.id);
      }
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "sign failed");
    } finally {
      setSigning(false);
    }
  };

  if (item.state === "rejected") {
    return (
      <DecisionComplete
        kind="declined"
        title="Declined."
        detail="This transaction was not signed or broadcast."
        onClose={onClose}
      />
    );
  }

  if (item.state === "approved") {
    // A signature is signed, not broadcast — there is no transaction hash.
    const txHash = isSignature ? undefined : isLive ? live.txHash : undefined;
    return (
      <DecisionComplete
        kind="approved"
        title={isSignature ? "Signed." : "Approved and broadcast."}
        detail={
          isSignature
            ? "The signature was returned to the requesting app. No funds moved when you signed."
            : "The transaction was signed and sent to Arbitrum."
        }
        txHash={txHash}
        onClose={onClose}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <button
        onClick={onClose}
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          border: 0,
          color: "var(--ink-2)",
          cursor: "pointer",
          fontSize: 13,
          fontFamily: "inherit",
          padding: 0,
        }}
      >
        ‹ Back to inbox
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SoftCard padding={28}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <AgentBadge agentId={item.agent} size={48} />
                <div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 500 }}>
                    {a.name} · {a.role}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 30,
                      lineHeight: 1.15,
                      fontWeight: 400,
                      letterSpacing: "-0.02em",
                      marginTop: 4,
                    }}
                  >
                    {item.intent}
                  </div>
                  {isLive && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-3)",
                        fontFamily: "var(--font-mono)",
                        marginTop: 6,
                      }}
                    >
                      to {live.tx.to}
                    </div>
                  )}
                </div>
              </div>
              {stageReady ? (
                <RiskChip risk={item.risk} size="lg" />
              ) : (
                <LiveTag stage={isPolicyReview ? policy!.stage : live!.stage} />
              )}
            </div>
            <p style={{ marginTop: 16, fontSize: 15, color: "var(--ink-2)", lineHeight: 1.55 }}>
              {stageError
                ? `Guardian errored: ${live?.error ?? policy?.error ?? "unknown"}`
                : item.why}
            </p>
          </SoftCard>

          {isLive && !stageReady && !stageError && <ProgressCard live={live!} />}

          {stageReady && (
            <>
              {isSignature && sig && (
                <SoftCard padding={22}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ink-3)",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    Signature request
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr",
                      gap: "8px 14px",
                      fontSize: 13,
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ color: "var(--ink-3)" }}>From</span>
                    <span style={{ color: "var(--ink-1)" }}>
                      {sig.origin.name} · {safeHost(sig.origin.url)}
                    </span>
                    <span style={{ color: "var(--ink-3)" }}>Method</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-1)" }}>
                      {sig.method}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
                    {sig.view.kind === "typedData" ? "Typed data" : "Message"}
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      background: "var(--surface-2)",
                      borderRadius: 12,
                      fontSize: 12,
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      color: "var(--ink-1)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {sig.view.kind === "typedData"
                      ? JSON.stringify(sig.view.typedData, null, 2)
                      : sig.view.text}
                  </pre>
                </SoftCard>
              )}
              {isAgentInstall && agentInstall && (
                <SoftCard padding={22}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ink-3)",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    Install request
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr",
                      gap: "8px 14px",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--ink-3)" }}>Service</span>
                    <span style={{ color: "var(--ink-1)" }}>
                      {new URL(agentInstall.serviceUrl).host}
                    </span>
                    <span style={{ color: "var(--ink-3)" }}>Mallow main wallet</span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--ink-1)",
                        wordBreak: "break-all",
                      }}
                    >
                      {agentInstall.mallowMainWallet}
                    </span>
                    <span style={{ color: "var(--ink-3)" }}>Actions</span>
                    <span style={{ color: "var(--ink-1)" }}>
                      {agentInstall.request.actions.length}
                    </span>
                  </div>
                </SoftCard>
              )}
              {isPolicyReview && policy && (
                <SoftCard padding={22}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ink-3)",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    Policy summary
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr",
                      gap: "8px 14px",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--ink-3)" }}>Smart account</span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--ink-1)",
                        wordBreak: "break-all",
                      }}
                    >
                      {policy.data.smartAccountAddress}
                    </span>
                    <span style={{ color: "var(--ink-3)" }}>USDC</span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--ink-1)",
                        wordBreak: "break-all",
                      }}
                    >
                      {policy.data.contracts.usdc}
                    </span>
                    <span style={{ color: "var(--ink-3)" }}>Aave V3 Pool</span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--ink-1)",
                        wordBreak: "break-all",
                      }}
                    >
                      {policy.data.contracts.aavePool}
                    </span>
                    <span style={{ color: "var(--ink-3)" }}>Morpho vault</span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--ink-1)",
                        wordBreak: "break-all",
                      }}
                    >
                      {policy.data.contracts.morphoVault}
                    </span>
                  </div>
                  <ul
                    style={{
                      marginTop: 14,
                      paddingLeft: 18,
                      fontSize: 13,
                      color: "var(--ink-2)",
                      lineHeight: 1.55,
                    }}
                  >
                    <li>approve(USDC, Aave or Morpho only)</li>
                    <li>Aave supply / withdraw on behalf of your smart account</li>
                    <li>Morpho deposit / withdraw to your smart account</li>
                    <li>Anything else this key tries → reverted on-chain</li>
                  </ul>
                </SoftCard>
              )}
              {!isPolicyReview && !isAgentInstall && !isSignature && (
                <SoftCard padding={22}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ink-3)",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    What changes
                  </div>
                  <AssetDiff rows={item.assetDiff} />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 12,
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--ink-3)",
                    }}
                  >
                    <span>Network fee</span>
                    <span>{item.sim.gas}</span>
                  </div>
                  {item.sim.reverts && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: 4,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--c-crit-ink)",
                      }}
                    >
                      <span>Simulation</span>
                      <span>REVERTS</span>
                    </div>
                  )}
                </SoftCard>
              )}

              {((item.checks && item.checks.length > 0) || item.checkReasoning) && (
                <SoftCard padding={22}>
                  <button
                    type="button"
                    onClick={() =>
                      setChecksOpenManual((current) => (current === null ? !checksOpen : !current))
                    }
                    aria-expanded={checksOpen}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "transparent",
                      border: 0,
                      padding: 0,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        color: "var(--ink-3)",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      How Guardian checked this
                      {item.checks && item.checks.length > 0 && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--ink-3)",
                            background: "var(--surface-2)",
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontWeight: 500,
                            letterSpacing: 0,
                            textTransform: "none",
                          }}
                        >
                          {item.checks.length} step{item.checks.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        color: "var(--ink-3)",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <Chevron open={checksOpen} />
                    </span>
                  </button>
                  {checksOpen && (
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}
                    >
                      {item.checkReasoning && (
                        <div
                          style={{
                            paddingBottom: 14,
                            borderBottom: "1px solid var(--surface-edge)",
                          }}
                        >
                          <Prose text={item.checkReasoning} />
                        </div>
                      )}
                      {item.checks && item.checks.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {item.checks.map((c, i) => (
                            <div
                              key={i}
                              style={{
                                padding: "10px 12px",
                                background: "var(--surface-2)",
                                borderRadius: 12,
                                display: "grid",
                                gridTemplateColumns: "auto 1fr",
                                gap: 10,
                                alignItems: "flex-start",
                              }}
                            >
                              <span
                                style={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: 999,
                                  flexShrink: 0,
                                  marginTop: 1,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background: c.ok ? "var(--c-low-tint)" : "var(--c-crit-tint)",
                                  color: c.ok ? "var(--c-low-ink)" : "var(--c-crit-ink)",
                                }}
                              >
                                <Glyph name={c.ok ? "check" : "x"} size={13} stroke={2.6} />
                              </span>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{c.title}</div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: "var(--ink-2)",
                                    marginTop: 2,
                                    lineHeight: 1.5,
                                  }}
                                >
                                  {c.detail}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </SoftCard>
              )}

              {item.reasoning && (
                <SoftCard padding={22}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ink-3)",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    Guardian&rsquo;s analysis
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      color: "var(--ink-1)",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {item.reasoning}
                  </p>
                </SoftCard>
              )}

              {item.investigation && (
                <SoftCard padding={22}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ink-3)",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      marginBottom: 12,
                    }}
                  >
                    Guardian&rsquo;s full read
                  </div>
                  <Prose text={item.investigation} />
                </SoftCard>
              )}

              {item.findings.length > 0 && (
                <SoftCard padding={22}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ink-3)",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    Guardian findings
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {item.findings.map((f, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "12px 14px",
                          background: "var(--surface-2)",
                          borderRadius: 14,
                          display: "grid",
                          gridTemplateColumns: "auto 1fr",
                          gap: 12,
                          alignItems: "flex-start",
                        }}
                      >
                        <RiskChip risk={f.sev} size="sm" />
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</div>
                          <div
                            style={{
                              fontSize: 13,
                              color: "var(--ink-2)",
                              marginTop: 3,
                              lineHeight: 1.5,
                            }}
                          >
                            {f.detail}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </SoftCard>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {stageReady && <CounterpartyCard item={item} />}

          {stageReady && item.impacts.length > 0 && (
            <SoftCard padding={22}>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink-3)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  marginBottom: 10,
                }}
              >
                What this means for you
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 14,
                  color: "var(--ink-1)",
                  lineHeight: 1.6,
                }}
              >
                {item.impacts.map((imp, i) => (
                  <li key={i} style={{ marginTop: i ? 6 : 0 }}>
                    {imp}
                  </li>
                ))}
              </ul>
            </SoftCard>
          )}

          <SoftCard
            padding={22}
            style={{
              background:
                stageReady && item.risk === "critical" ? "var(--c-crit-tint)" : "var(--surface-1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: waitingForReview
                    ? "var(--accent-tint)"
                    : stageError
                      ? "var(--c-crit-tint)"
                      : "var(--surface-2)",
                  color: waitingForReview
                    ? "var(--accent-ink)"
                    : stageError
                      ? "var(--c-crit-ink)"
                      : "var(--ink-1)",
                }}
              >
                <Glyph
                  name={waitingForReview ? "shield" : stageError ? "x" : "fingerprint"}
                  size={17}
                  stroke={2}
                />
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {waitingForReview
                    ? "Waiting for Guardian"
                    : stageError
                      ? "Review unavailable"
                      : "Your decision"}
                </div>
                <div
                  style={{ marginTop: 3, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}
                >
                  {waitingForReview
                    ? "Guardian is reading the transaction. You can decline now, or approve after the verdict is ready."
                    : stageError
                      ? "The review did not finish. Decline this request or try a new transaction."
                      : "Review the asset changes and findings, then approve or decline."}
                </div>
              </div>
            </div>
            {stageReady && item.requiresTyping && (
              <>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--c-crit-ink)",
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  ⚠ Type &ldquo;I UNDERSTAND&rdquo; to enable approval
                </div>
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="I UNDERSTAND"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid var(--surface-edge)",
                    background: "var(--surface-0)",
                    color: "var(--ink-1)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 14,
                    outline: "none",
                    marginBottom: 12,
                    boxSizing: "border-box",
                  }}
                />
              </>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <Btn kind="ghost" full onClick={() => reject(item.id)}>
                Decline
              </Btn>
              <Btn
                kind={stageReady && item.risk === "critical" ? "danger" : "primary"}
                full
                disabled={!canApprove || signing}
                onClick={sign}
                icon="fingerprint"
              >
                {approveLabel}
              </Btn>
            </div>
            {signError && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--c-crit-ink)" }}>
                {signError}
              </div>
            )}
            <div
              style={{ marginTop: 10, fontSize: 11, color: "var(--ink-3)", textAlign: "center" }}
            >
              Mallow uses your device passkey · nothing leaves this machine
            </div>
          </SoftCard>
        </div>
      </div>
    </div>
  );
}

function DecisionComplete({
  kind,
  title,
  detail,
  txHash,
  onClose,
}: {
  kind: "approved" | "declined";
  title: string;
  detail: string;
  txHash?: string;
  onClose: () => void;
}) {
  const approved = kind === "approved";
  return (
    <div
      style={{
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 40,
      }}
    >
      <span
        style={{
          width: 80,
          height: 80,
          borderRadius: 999,
          background: approved ? "var(--c-low)" : "var(--surface-2)",
          color: approved ? "var(--c-low-ink)" : "var(--ink-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Glyph name={approved ? "check" : "x"} size={40} stroke={2.4} />
      </span>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 36,
          fontWeight: 400,
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </div>
      <div style={{ marginTop: 6, color: "var(--ink-2)", fontSize: 14 }}>{detail}</div>
      {txHash && (
        <div style={{ marginTop: 8, fontSize: 14, color: "var(--ink-2)" }}>
          <a
            href={txExplorerUrl(DEFAULT_CHAIN_ID, txHash)}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent-ink)", fontFamily: "var(--font-mono)" }}
          >
            {txHash.slice(0, 10)}…{txHash.slice(-6)}
          </a>
        </div>
      )}
      <div style={{ marginTop: 24 }}>
        <Btn kind="ghost" onClick={onClose}>
          Back to inbox
        </Btn>
      </div>
    </div>
  );
}

function CounterpartyCard({ item }: { item: QueueItem }) {
  const kind = item.counterparty.kind ?? (item.counterparty.verified ? "verified" : "unverified");
  const palette =
    kind === "verified"
      ? {
          bg: "var(--c-low-tint)",
          fg: "var(--c-low-ink)",
          glyph: "check" as const,
          label: `Verified · ${item.counterparty.age}`,
        }
      : kind === "eoa"
        ? {
            bg: "var(--c-info)",
            fg: "var(--c-info-ink)",
            glyph: "wallet" as const,
            label: "Externally-owned wallet (no contract code)",
          }
        : {
            bg: "var(--c-crit-tint)",
            fg: "var(--c-crit-ink)",
            glyph: "x" as const,
            label: "Unverified or new address",
          };
  return (
    <SoftCard padding={22}>
      <div
        style={{
          fontSize: 13,
          color: "var(--ink-3)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Counterparty
      </div>
      <div
        style={{
          background: palette.bg,
          color: palette.fg,
          padding: 14,
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Glyph name={palette.glyph} size={20} stroke={2.4} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{item.counterparty.name}</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{palette.label}</div>
        </div>
      </div>
    </SoftCard>
  );
}

function LiveTag({ stage }: { stage: LiveStage }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: 999,
        background: stage === "error" ? "var(--c-crit-tint)" : "var(--accent-tint)",
        color: stage === "error" ? "var(--c-crit-ink)" : "var(--accent-ink)",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {stage !== "error" && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "currentColor",
            animation: "ml-pulse 1.4s ease-out infinite",
          }}
        />
      )}
      {stage === "error" ? "Error" : "Checking"}
    </span>
  );
}
