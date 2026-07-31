"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import { AGENTS } from "@/lib/agent-plugins/agents";
import { AgentBadge, Btn, CopyButton, Glyph, MallowMark } from "@/components/ui";
import { InjectedWalletOptions } from "@/components/InjectedWalletOptions";
import type { Eip1193Provider } from "@/lib/wallet/eip6963";

export default function OnboardingPage() {
  const router = useRouter();
  const { create, connect, state } = useWallet();
  const [step, setStep] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const triggerPasskey = async () => {
    setScanning(true);
    setErr(null);
    try {
      await create();
      setStep(2);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "passkey failed");
    } finally {
      setScanning(false);
    }
  };

  const triggerConnect = async (opts: { provider?: Eip1193Provider; rdns?: string }) => {
    await connect(opts);
    setStep(2);
  };

  const finish = () => router.replace("/");

  const address =
    state.kind === "locked"
      ? state.address
      : state.kind === "unlocked"
        ? state.wallet.address
        : null;
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "0x…";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-canvas)",
        padding: 32,
      }}
    >
      <div style={{ width: "100%", maxWidth: 540, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <MallowMark size={72} />
        </div>

        {step === 0 && (
          <>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 56,
                lineHeight: 1.05,
                margin: 0,
                fontWeight: 400,
                letterSpacing: "-0.02em",
              }}
            >
              A wallet that
              <br />
              <em style={{ fontStyle: "italic", color: "var(--accent-ink)" }}>thinks with you.</em>
            </h1>
            <p style={{ marginTop: 18, fontSize: 17, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Mallow runs alongside agents that earn yield — and a Guardian that reads every
              transaction before you sign.
            </p>
            <div style={{ marginTop: 32 }}>
              <Btn size="lg" onClick={() => setStep(1)} icon="arrow">
                Begin
              </Btn>
            </div>
            <p style={{ marginTop: 18, fontSize: 12, color: "var(--ink-3)" }}>
              No seed phrase. No browser extension. Just your device.
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 44,
                margin: 0,
                fontWeight: 400,
                letterSpacing: "-0.02em",
              }}
            >
              Sign in with <em style={{ color: "var(--accent-ink)" }}>your face.</em>
            </h1>
            <p style={{ marginTop: 14, fontSize: 16, color: "var(--ink-2)" }}>
              We&apos;ll create a passkey on this device. It never leaves — Mallow can&apos;t see
              it, and neither can anyone else.
            </p>
            <div style={{ marginTop: 36, display: "flex", justifyContent: "center" }}>
              <button
                onClick={triggerPasskey}
                disabled={scanning}
                style={{
                  width: 156,
                  height: 156,
                  borderRadius: 999,
                  background: "var(--surface-1)",
                  border: "1px solid var(--surface-edge)",
                  boxShadow: scanning
                    ? "0 0 0 8px var(--accent-tint), var(--shadow-lift)"
                    : "var(--shadow-soft)",
                  cursor: scanning ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: scanning ? "var(--accent-ink)" : "var(--ink-1)",
                  transition: "all 280ms ease",
                  position: "relative",
                }}
              >
                <Glyph name="fingerprint" size={64} stroke={1.4} />
                {scanning && (
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: 999,
                      border: "2px solid var(--accent)",
                      animation: "ml-pulse 1.4s ease-out infinite",
                    }}
                  />
                )}
              </button>
            </div>
            <p style={{ marginTop: 22, fontSize: 14, color: "var(--ink-3)", minHeight: 20 }}>
              {scanning ? "Look at your camera…" : "Tap to begin"}
            </p>

            <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ flex: 1, height: 1, background: "var(--surface-edge)" }} />
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>or connect a wallet</span>
              <span style={{ flex: 1, height: 1, background: "var(--surface-edge)" }} />
            </div>
            <div style={{ marginTop: 18, textAlign: "left" }}>
              <InjectedWalletOptions onConnect={triggerConnect} disabled={scanning} />
            </div>
            <p style={{ marginTop: 14, fontSize: 12, color: "var(--ink-3)" }}>
              Bring your own MetaMask, Rainbow, or other browser wallet — you keep custody of your
              keys.
            </p>

            {err && (
              <p style={{ marginTop: 12, fontSize: 13, color: "var(--c-crit-ink)" }}>{err}</p>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 40,
                margin: 0,
                fontWeight: 400,
                letterSpacing: "-0.02em",
              }}
            >
              Choose your <em style={{ color: "var(--accent-ink)" }}>helpers.</em>
            </h1>
            <p style={{ marginTop: 12, fontSize: 15, color: "var(--ink-2)" }}>
              Guardian is always on. Pick others to invite — you can always add or remove later.
            </p>
            <div
              style={{
                marginTop: 28,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                textAlign: "left",
              }}
            >
              {Object.values(AGENTS).map((a) => (
                <div
                  key={a.id}
                  style={{
                    background: "var(--surface-1)",
                    borderRadius: 18,
                    padding: 16,
                    border: "1px solid var(--surface-edge)",
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <AgentBadge agentId={a.id} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
                      {a.role}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.4 }}>
                      {a.blurb}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "4px 9px",
                      borderRadius: 999,
                      background: a.always ? "var(--c-low)" : "var(--surface-2)",
                      color: a.always ? "var(--c-low-ink)" : "var(--ink-2)",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.always ? "always on" : "invited"}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 28 }}>
              <Btn size="lg" onClick={() => setStep(3)} icon="arrow">
                Continue
              </Btn>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <span
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 999,
                  background: "var(--c-low)",
                  color: "var(--c-low-ink)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Glyph name="check" size={32} stroke={2.4} />
              </span>
            </div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 44,
                margin: 0,
                fontWeight: 400,
                letterSpacing: "-0.02em",
              }}
            >
              You&apos;re <em style={{ color: "var(--accent-ink)" }}>in.</em>
            </h1>
            <p style={{ marginTop: 14, fontSize: 16, color: "var(--ink-2)" }}>
              Address{" "}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  verticalAlign: "middle",
                }}
              >
                <code
                  style={{
                    fontFamily: "var(--font-mono)",
                    background: "var(--surface-2)",
                    padding: "2px 8px",
                    borderRadius: 6,
                  }}
                >
                  {short}
                </code>
                <CopyButton value={address} size={12} />
              </span>{" "}
              {state.kind === "unlocked" && state.wallet.kind === "injected"
                ? "connected"
                : "created"}
              . Fund it from any exchange or another wallet.
            </p>
            <div style={{ marginTop: 32 }}>
              <Btn size="lg" onClick={finish} icon="arrow">
                Open Mallow
              </Btn>
            </div>
          </>
        )}

        <div style={{ marginTop: 56, display: "flex", justifyContent: "center", gap: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              style={{
                width: i === step ? 24 : 8,
                height: 8,
                borderRadius: 999,
                background: i === step ? "var(--accent)" : "var(--surface-edge)",
                transition: "all 280ms ease",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
