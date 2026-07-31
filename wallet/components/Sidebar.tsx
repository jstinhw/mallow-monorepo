"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyButton, Glyph, MallowMark } from "@/components/ui";
import { useWallet } from "@/hooks/useWallet";
import { getChain, DEFAULT_CHAIN_ID } from "@/lib/constants/chains";

export type Route = "home" | "inbox" | "token" | "activity" | "agent" | "connections";

const ITEMS: {
  key: Route;
  label: string;
  icon: "home" | "inbox" | "history" | "spark" | "wallet" | "leaf" | "merge";
  href: string;
}[] = [
  { key: "home", label: "Home", icon: "home", href: "/" },
  { key: "inbox", label: "Inbox", icon: "inbox", href: "/inbox" },
  { key: "token", label: "Tokens", icon: "wallet", href: "/token" },
  { key: "activity", label: "Activity", icon: "history", href: "/activity" },
  { key: "agent", label: "Agents", icon: "spark", href: "/agent" },
  { key: "connections", label: "Connections", icon: "merge", href: "/connections" },
];

export function Sidebar({ route, pendingCount }: { route: Route; pendingCount: number }) {
  const router = useRouter();
  const { state, exportPrivateKey, logout } = useWallet();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [privateKey, setPrivateKey] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const address =
    state.kind === "unlocked"
      ? state.wallet.address
      : state.kind === "locked"
        ? state.address
        : "0x0000…0000";
  const walletKind =
    state.kind === "unlocked"
      ? state.wallet.kind
      : state.kind === "locked"
        ? (state.walletKind ?? "passkey")
        : "passkey";
  const canExportPrivateKey = walletKind === "passkey";
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  const clearExport = () => {
    setConfirmExport(false);
    setPrivateKey(null);
    setBusy(false);
    setCopied(false);
    setErr(null);
  };

  const closeSettings = () => {
    clearExport();
    setSettingsOpen(false);
  };

  const revealPrivateKey = async () => {
    setBusy(true);
    setCopied(false);
    setErr(null);
    try {
      setPrivateKey(await exportPrivateKey());
    } catch (e) {
      setPrivateKey(null);
      setErr(e instanceof Error ? e.message : "Private key export failed.");
    } finally {
      setBusy(false);
    }
  };

  const copyPrivateKey = async () => {
    if (!privateKey) return;
    setCopied(false);
    setErr(null);
    try {
      await navigator.clipboard.writeText(privateKey);
      setCopied(true);
    } catch {
      setErr("Clipboard access was blocked.");
    }
  };

  return (
    <aside
      style={{
        width: 248,
        padding: "24px 18px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        borderRight: "1px solid var(--surface-edge)",
        background: "var(--bg-rail)",
        height: "calc(100vh - 30px)",
        position: "sticky",
        top: 30,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px" }}>
        <MallowMark size={32} />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 24,
            fontWeight: 400,
            letterSpacing: "-0.01em",
          }}
        >
          mallow
        </span>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {ITEMS.map((it) => {
          const active = route === it.key;
          const badge = it.key === "inbox" ? pendingCount : 0;
          return (
            <button
              key={it.key}
              onClick={() => router.push(it.href)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 12,
                background: active ? "var(--surface-1)" : "transparent",
                color: active ? "var(--ink-1)" : "var(--ink-2)",
                border: 0,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                textAlign: "left",
                boxShadow: active ? "var(--shadow-soft)" : "none",
                transition: "all 140ms ease",
              }}
            >
              <Glyph name={it.icon} size={18} />
              <span style={{ flex: 1 }}>{it.label}</span>
              {badge > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    background: "var(--accent)",
                    color: "var(--surface-0)",
                    borderRadius: 999,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <ChainBadge />
        {settingsOpen && (
          <div
            style={{
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              background: "var(--surface-1)",
              borderRadius: 14,
              border: "1px solid var(--surface-edge)",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Wallet settings</div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "var(--ink-3)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <span>{short}</span>
                  <CopyButton value={address} size={11} />
                </div>
              </div>
              <button
                type="button"
                aria-label="Close wallet settings"
                onClick={closeSettings}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  border: "1px solid var(--surface-edge)",
                  background: "transparent",
                  color: "var(--ink-2)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Glyph name="x" size={14} />
              </button>
            </div>

            {!confirmExport && !privateKey && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {canExportPrivateKey && (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmExport(true);
                      setErr(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "9px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--surface-edge)",
                      background: "var(--surface-2)",
                      color: "var(--ink-1)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <Glyph name="key" size={14} /> Export private key
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm("Are you sure you want to log out?")) {
                      await logout();
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 10,
                    border: "1px solid var(--surface-edge)",
                    background: "var(--surface-2)",
                    color: "var(--c-crit-ink)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <Glyph name="log-out" size={14} /> Log out
                </button>
              </div>
            )}

            {canExportPrivateKey && confirmExport && !privateKey && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p
                  style={{ margin: 0, color: "var(--c-crit-ink)", fontSize: 12, lineHeight: 1.45 }}
                >
                  Anyone with this private key can control this wallet. Reveal it only somewhere
                  private.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={revealPrivateKey}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--c-crit-ink)",
                    background: "var(--c-crit-ink)",
                    color: "#fff",
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <Glyph name="fingerprint" size={14} />
                  {busy ? "Waiting for passkey..." : "Reveal with passkey"}
                </button>
              </div>
            )}

            {canExportPrivateKey && privateKey && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <textarea
                  readOnly
                  value={privateKey}
                  aria-label="Private key"
                  rows={3}
                  style={{
                    resize: "none",
                    width: "100%",
                    boxSizing: "border-box",
                    border: "1px solid var(--surface-edge)",
                    borderRadius: 10,
                    background: "var(--surface-2)",
                    color: "var(--ink-1)",
                    padding: 10,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    lineHeight: 1.45,
                    overflowWrap: "anywhere",
                  }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    type="button"
                    onClick={copyPrivateKey}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      padding: "9px 10px",
                      borderRadius: 10,
                      border: 0,
                      background: "var(--ink-1)",
                      color: "var(--surface-0)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <Glyph name={copied ? "check" : "copy"} size={13} />
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={clearExport}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      padding: "9px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--surface-edge)",
                      background: "transparent",
                      color: "var(--ink-2)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <Glyph name="x" size={13} /> Hide
                  </button>
                </div>
              </div>
            )}

            {err && (
              <p style={{ margin: 0, color: "var(--c-crit-ink)", fontSize: 12, lineHeight: 1.4 }}>
                {err}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (settingsOpen) closeSettings();
            else setSettingsOpen(true);
          }}
          aria-expanded={settingsOpen}
          aria-label="Wallet settings"
          style={{
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--surface-1)",
            borderRadius: 14,
            border: "1px solid var(--surface-edge)",
            cursor: "pointer",
            fontFamily: "inherit",
            color: "var(--ink-1)",
            textAlign: "left",
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              flexShrink: 0,
              background: "linear-gradient(135deg, #f4d4b3, #d99a6f)",
            }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
              }}
            >
              {short}
            </span>
            <span
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Glyph name={walletKind === "passkey" ? "key" : "wallet"} size={10} />{" "}
              {walletKind === "passkey" ? "passkey" : "browser wallet"}
            </span>
          </span>
          <Glyph name="settings" size={14} />
        </button>
      </div>
    </aside>
  );
}

function ChainBadge() {
  const chain = getChain(DEFAULT_CHAIN_ID);
  if (!chain) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 12,
        background: "var(--surface-1)",
        border: "1px solid var(--surface-edge)",
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          background: chain.color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: 9,
          fontWeight: 800,
          color: "#fff",
          letterSpacing: "-0.02em",
        }}
      >
        {chain.chain.name.slice(0, 2).toUpperCase()}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink-1)",
            lineHeight: 1.2,
          }}
        >
          {chain.chain.name}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10,
            color: "var(--ink-3)",
            marginTop: 1,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--c-pos)",
              flexShrink: 0,
            }}
          />
          Connected
        </span>
      </span>
    </div>
  );
}
