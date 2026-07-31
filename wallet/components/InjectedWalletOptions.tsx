"use client";
import { useState } from "react";
import { Glyph } from "@/components/ui";
import { useInjectedWallets } from "@/hooks/useInjectedWallets";
import type { Eip1193Provider } from "@/lib/wallet/eip6963";

type ConnectOpts = { provider?: Eip1193Provider; rdns?: string };

// Lists every browser wallet found via EIP-6963 (MetaMask, Rainbow, Coinbase, …)
// as its own button. Falls back to a single generic button when none announce
// themselves but a legacy `window.ethereum` may still be present. Owns its busy
// and error state; `onConnect` performs the actual connection.
export function InjectedWalletOptions({
  onConnect,
  disabled = false,
}: {
  onConnect: (opts: ConnectOpts) => Promise<void>;
  disabled?: boolean;
}) {
  const wallets = useInjectedWallets();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const connect = async (key: string, opts: ConnectOpts) => {
    setBusyKey(key);
    setErr(null);
    try {
      await onConnect(opts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "wallet connection failed");
    } finally {
      setBusyKey(null);
    }
  };

  const rows =
    wallets.length > 0
      ? wallets.map((w) => ({
          key: w.info.rdns,
          name: w.info.name,
          icon: w.info.icon,
          opts: { provider: w.provider, rdns: w.info.rdns } as ConnectOpts,
        }))
      : [{ key: "injected", name: "Browser wallet", icon: null, opts: {} as ConnectOpts }];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((row) => {
        const busy = busyKey === row.key;
        const isDisabled = disabled || busyKey !== null;
        return (
          <button
            key={row.key}
            onClick={() => connect(row.key, row.opts)}
            disabled={isDisabled}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              padding: "12px 16px",
              background: "var(--surface-1)",
              border: "1px solid var(--surface-edge)",
              borderRadius: 14,
              cursor: isDisabled ? "not-allowed" : "pointer",
              opacity: isDisabled && !busy ? 0.55 : 1,
              fontFamily: "inherit",
              fontSize: 15,
              fontWeight: 600,
              color: "var(--ink-1)",
              transition: "opacity 120ms ease",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--surface-2)",
                overflow: "hidden",
              }}
            >
              {row.icon ? (
                // EIP-6963 icons are wallet-supplied data URIs; next/image adds no value here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.icon}
                  alt=""
                  width={28}
                  height={28}
                  style={{ objectFit: "contain" }}
                />
              ) : (
                <Glyph name="wallet" size={16} />
              )}
            </span>
            <span style={{ flex: 1, textAlign: "left" }}>{row.name}</span>
            <span style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 500 }}>
              {busy ? "Check your wallet…" : "Connect"}
            </span>
          </button>
        );
      })}
      {err && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--c-crit-ink)", textAlign: "center" }}>
          {err}
        </p>
      )}
    </div>
  );
}
