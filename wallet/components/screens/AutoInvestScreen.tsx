"use client";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { Btn, Glyph } from "@/components/ui";
import { useAgentPluginStatus } from "@/hooks/useAgentPluginStatus";
import { useUninstallAgent } from "@/hooks/useUninstallAgent";
import { useWallet } from "@/hooks/useWallet";

export function AutoInvestScreen({ onBack }: { onBack: () => void }) {
  const { state } = useWallet();
  const address =
    state.kind === "unlocked"
      ? state.wallet.address
      : state.kind === "locked"
        ? state.address
        : null;
  const agent = useAgentPluginStatus("auto-invest", address);
  const installation = agent.installation;

  // Auto-invest runs as an external plugin agent now — with no installation
  // there is nothing to render, so return to the agents list.
  useEffect(() => {
    if (agent.loading) return;
    if (!installation) onBack();
  }, [agent.loading, installation, onBack]);

  if (agent.loading) {
    return <p style={{ color: "var(--ink-2)" }}>Loading auto-invest...</p>;
  }

  if (!installation || !installation.mallowMainWallet || !installation.agentId) {
    return <p style={{ color: "var(--ink-2)" }}>Redirecting...</p>;
  }

  return (
    <PluginStatusAutoInvestScreen
      status={agent.status}
      statusHtml={agent.statusHtml}
      error={agent.error}
      mallowMainWallet={installation.mallowMainWallet}
      agentId={installation.agentId}
      onBack={onBack}
      installation={installation}
      onRefresh={agent.refresh}
    />
  );
}

function UninstallPanel({
  installation,
  onRefresh,
}: {
  installation: NonNullable<ReturnType<typeof useAgentPluginStatus>["installation"]>;
  onRefresh: () => Promise<void> | void;
}) {
  const [confirm, setConfirm] = useState(false);
  const { uninstalling, error, result, uninstall, reset } = useUninstallAgent(
    installation,
    onRefresh,
  );

  return (
    <div className="ml-card" style={{ padding: 26 }}>
      <div className="ml-section-label">Remove agent</div>
      <p style={{ color: "var(--ink-2)", fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
        Uninstalling withdraws all managed USDC and returns it to your main wallet, then revokes the
        agent&apos;s session key.
      </p>
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        {confirm ? (
          <>
            <Btn kind="ghost" size="sm" onClick={() => void uninstall()} disabled={uninstalling}>
              {uninstalling ? "Uninstalling…" : "Confirm uninstall"}
            </Btn>
            <Btn kind="ghost" size="sm" onClick={() => setConfirm(false)} disabled={uninstalling}>
              Cancel
            </Btn>
          </>
        ) : (
          <Btn
            kind="ghost"
            size="sm"
            icon="x"
            onClick={() => {
              reset();
              setConfirm(true);
            }}
          >
            Uninstall agent
          </Btn>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--c-crit-ink)" }}>{error}</div>
      )}
      {result && <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-2)" }}>{result}</div>}
    </div>
  );
}

function PluginStatusAutoInvestScreen({
  status,
  statusHtml,
  error,
  agentId,
  onBack,
  installation,
  onRefresh,
}: {
  status: unknown;
  statusHtml: string | null;
  error: string | null;
  mallowMainWallet: Address;
  agentId: string;
  onBack: () => void;
  installation: NonNullable<ReturnType<typeof useAgentPluginStatus>["installation"]>;
  onRefresh: () => Promise<void> | void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <button
        onClick={onBack}
        style={{
          alignSelf: "flex-start",
          background: "transparent",
          border: 0,
          color: "var(--ink-2)",
          cursor: "pointer",
          fontSize: 13,
          fontFamily: "inherit",
          padding: 0,
        }}
      >
        ‹ Back to Agents
      </button>

      <div className="ml-card" style={{ padding: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            className="ml-account-avatar"
            style={{ background: "var(--acc-sprout-grad)", color: "white" }}
          >
            <Glyph name="leaf" size={22} stroke={1.8} />
          </span>
          <div>
            <div className="ml-section-label">Sprout · external agent</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 24, marginTop: 2 }}>
              Installed through plugin service
            </div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <KeyValue label="Agent ID" value={agentId} />
          <KeyValue label="Service status" value={error ? `Error: ${error}` : "Polling"} plain />
        </div>
      </div>

      <div className="ml-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="ml-section-label" style={{ padding: "20px 24px 0" }}>
          Live view
        </div>
        {statusHtml ? (
          // The plugin service controls this HTML. It's rendered inside a
          // sandbox-only iframe so it cannot read parent DOM, cookies, or
          // make network calls in our origin.
          <iframe
            title="Sprout status"
            srcDoc={statusHtml}
            sandbox=""
            referrerPolicy="no-referrer"
            style={{
              width: "100%",
              height: 520,
              border: 0,
              marginTop: 12,
              background: "transparent",
              display: "block",
            }}
          />
        ) : (
          <pre
            style={{
              margin: 0,
              padding: 20,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            {JSON.stringify(status ?? { loading: true }, null, 2)}
          </pre>
        )}
      </div>

      <UninstallPanel installation={installation} onRefresh={onRefresh} />
    </div>
  );
}

function KeyValue({
  label,
  value,
  plain = false,
}: {
  label: string;
  value: React.ReactNode;
  plain?: boolean;
}) {
  return (
    <div className="ml-kv">
      <span className="ml-kv-key">{label}</span>
      <span className="ml-kv-val" style={plain ? { fontFamily: "inherit" } : undefined}>
        {value}
      </span>
    </div>
  );
}
