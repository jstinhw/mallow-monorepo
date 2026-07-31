"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sidebar, type Route } from "@/components/Sidebar";
import { ToastStack } from "@/components/ToastStack";
import { Btn, Glyph, MallowMark } from "@/components/ui";
import { InjectedWalletOptions } from "@/components/InjectedWalletOptions";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";
import { useWallet } from "@/hooks/useWallet";
import type { Eip1193Provider } from "@/lib/wallet/eip6963";

type Props = {
  route: Route;
  eyebrow: ReactNode;
  title: string;
  children: ReactNode;
  topRight?: ReactNode;
};

export function WalletPageShell({ route, eyebrow, title, children, topRight }: Props) {
  const { state, unlock, connect } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (state.kind === "absent") router.replace("/onboarding");
  }, [state.kind, router]);

  if (state.kind === "loading") {
    return (
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "radial-gradient(circle at center, var(--surface-1), var(--bg-canvas))",
          fontFamily: "var(--font-sans)",
          padding: 32,
          boxSizing: "border-box",
        }}
      >
        <style
          dangerouslySetInnerHTML={{
            __html: `
          @keyframes bounce-gentle {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
          }
          @keyframes shimmer {
            0% { left: -50%; }
            100% { left: 100%; }
          }
        `,
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
            textAlign: "center",
            maxWidth: 320,
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                position: "absolute",
                width: 80,
                height: 80,
                borderRadius: "999px",
                background: "var(--acc-main-grad)",
                opacity: 0.15,
                filter: "blur(20px)",
                animation: "ml-sprout-pulse 2s infinite ease-in-out",
              }}
            />
            <div
              style={{
                animation: "bounce-gentle 3s infinite ease-in-out",
                position: "relative",
                zIndex: 1,
              }}
            >
              <MallowMark size={72} />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 28,
                fontWeight: 400,
                color: "var(--ink-1)",
                margin: 0,
              }}
            >
              Opening your wallet
            </h1>
            <p
              style={{
                fontSize: 13,
                color: "var(--ink-3)",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              Securing session connection...
            </p>
          </div>

          <div
            style={{
              width: 140,
              height: 3,
              background: "var(--surface-edge)",
              borderRadius: 99,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: "50%",
                background: "var(--acc-sprout-grad)",
                borderRadius: 99,
                animation: "shimmer 1.5s infinite ease-in-out",
              }}
            />
          </div>
        </div>
      </main>
    );
  }
  if (state.kind === "absent") {
    return null;
  }
  if (state.kind === "locked") {
    return (
      <UnlockGate
        onUnlock={unlock}
        onConnect={connect}
        address={state.address}
        walletKind={state.walletKind ?? "passkey"}
      />
    );
  }

  return (
    <WalletFrame route={route} eyebrow={eyebrow} title={title} topRight={topRight}>
      {children}
    </WalletFrame>
  );
}

function WalletFrame({
  route,
  eyebrow,
  title,
  topRight,
  children,
}: {
  route: Route;
  eyebrow: ReactNode;
  title: string;
  topRight?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const { pending } = useApprovalQueue();
  const pendingCount = pending.length;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-canvas)" }}>
      <Sidebar route={route} pendingCount={pendingCount} />

      <main style={{ flex: 1, padding: "62px 40px 80px", maxWidth: 1280 }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 28,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {eyebrow}
            </div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 40,
                fontWeight: 400,
                letterSpacing: "-0.02em",
                margin: 0,
                marginTop: 2,
              }}
            >
              {title}
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {topRight}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 999,
                background: "var(--surface-1)",
                border: "1px solid var(--surface-edge)",
                fontSize: 13,
              }}
            >
              <Glyph name="bell" size={14} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {pendingCount} waiting
              </span>
            </span>
          </div>
        </header>

        {children}
      </main>

      <ToastStack onOpen={(id) => router.push(`/inbox?item=${encodeURIComponent(id)}`)} />
    </div>
  );
}

function UnlockGate({
  onUnlock,
  onConnect,
  address,
  walletKind,
}: {
  onUnlock: () => Promise<void>;
  onConnect: (opts: { provider?: Eip1193Provider; rdns?: string }) => Promise<void>;
  address: string;
  walletKind: "passkey" | "injected";
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const hasPasskey = walletKind === "passkey";
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          textAlign: "center",
          background: "var(--surface-1)",
          borderRadius: 22,
          padding: 32,
          boxShadow: "var(--shadow-soft)",
          border: "1px solid var(--surface-edge)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <MallowMark size={56} />
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 32,
            fontWeight: 400,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Welcome back.
        </h1>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--ink-3)" }}>
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
        </p>

        {hasPasskey && (
          <div style={{ marginTop: 24 }}>
            <Btn
              kind="primary"
              size="lg"
              full
              icon="fingerprint"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await onUnlock();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "unlock failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Waiting for passkey…" : "Unlock with passkey"}
            </Btn>
            {err && (
              <p style={{ marginTop: 14, color: "var(--c-crit-ink)", fontSize: 13 }}>{err}</p>
            )}
          </div>
        )}

        <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, height: 1, background: "var(--surface-edge)" }} />
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {hasPasskey ? "or connect a wallet" : "connect your wallet"}
          </span>
          <span style={{ flex: 1, height: 1, background: "var(--surface-edge)" }} />
        </div>
        <div style={{ marginTop: 18, textAlign: "left" }}>
          <InjectedWalletOptions onConnect={onConnect} disabled={busy} />
        </div>
        {hasPasskey && (
          <p style={{ marginTop: 14, fontSize: 12, color: "var(--ink-3)" }}>
            Your passkey wallet stays saved — connecting another wallet just uses it for this
            session.
          </p>
        )}
      </div>
    </main>
  );
}
