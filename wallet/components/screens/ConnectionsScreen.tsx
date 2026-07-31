"use client";
import { useState } from "react";
import { SoftCard, Btn } from "@/components/ui";
import { useWalletConnect } from "@/hooks/useWalletConnect";
import { parseWcUri } from "@/lib/walletconnect/requests";

export function ConnectionsScreen() {
  const { status, sessions, pendingProposal, pair, approveProposal, rejectProposal, disconnect } =
    useWalletConnect();
  const [uri, setUri] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "disabled") {
    return (
      <SoftCard padding={24}>
        <div style={{ fontSize: 15, color: "var(--ink-1)", fontWeight: 600, marginBottom: 6 }}>
          WalletConnect isn’t configured
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
          Set <code>NEXT_PUBLIC_REOWN_PROJECT_ID</code> in <code>.env.local</code> (free at
          cloud.reown.com) and restart to connect to dApps.
        </p>
      </SoftCard>
    );
  }

  const onConnect = async () => {
    const parsed = parseWcUri(uri);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await pair(parsed.uri);
      setUri("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to pair.");
    } finally {
      setBusy(false);
    }
  };

  const onApprove = async () => {
    setError(null);
    try {
      await approveProposal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect.");
    }
  };
  const onReject = async () => {
    setError(null);
    try {
      await rejectProposal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          Connect to a dApp
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
          In the dApp, choose <strong>WalletConnect</strong>, copy the connection link, and paste it
          here.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={uri}
            onChange={(e) => {
              setUri(e.target.value);
              setError(null);
            }}
            placeholder="wc:…"
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid var(--surface-edge)",
              background: "var(--surface-2)",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "var(--ink-1)",
            }}
          />
          <Btn kind="primary" size="md" onClick={onConnect} disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </Btn>
        </div>
        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--c-crit-ink)" }}>{error}</div>
        )}
      </SoftCard>

      {pendingProposal && (
        <SoftCard padding={22} style={{ border: "1px solid var(--accent)" }}>
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
            Connection request
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{pendingProposal.name}</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{pendingProposal.url}</div>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 14 }}>
            Requested chains: {pendingProposal.chains.join(", ") || "any supported"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn kind="primary" size="md" onClick={onApprove}>
              Connect
            </Btn>
            <Btn kind="ghost" size="md" onClick={onReject}>
              Reject
            </Btn>
          </div>
        </SoftCard>
      )}

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
          Active connections
        </div>
        {sessions.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)", fontStyle: "italic" }}>
            No dApps connected.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sessions.map((s) => (
              <div
                key={s.topic}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  background: "var(--surface-2)",
                  borderRadius: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{s.url}</div>
                </div>
                <Btn kind="ghost" size="sm" icon="x" onClick={() => disconnect(s.topic)}>
                  Disconnect
                </Btn>
              </div>
            ))}
          </div>
        )}
      </SoftCard>
    </div>
  );
}
