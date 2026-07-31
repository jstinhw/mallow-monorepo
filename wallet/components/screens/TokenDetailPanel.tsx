"use client";
import type { Address } from "viem";
import { useTokenPortfolio } from "@/hooks/useTokenPortfolio";
import { useWallet } from "@/hooks/useWallet";
import { tokenKey, getChain } from "@/lib/constants/chains";
import { formatTokenAmount, formatUsd } from "@/lib/wallet/portfolio-display";
import { SoftCard } from "@/components/ui";
import type { TokenHolding } from "@/types/core";

type Props = {
  tokenKey: string;
  onBack: () => void;
  onSend: (key: string, chainId: number) => void;
};

export function TokenDetailPanel({ tokenKey: key, onBack, onSend }: Props) {
  const { state } = useWallet();
  const address: Address | null =
    state.kind === "unlocked"
      ? state.wallet.address
      : state.kind === "locked"
        ? state.address
        : null;

  const { holdings } = useTokenPortfolio(address);
  const holding = holdings.find((h) => tokenKey(h.symbol, h.tokenAddress) === key);

  if (!holding) {
    return (
      <div style={{ padding: 32 }}>
        <button onClick={onBack} style={backBtnStyle}>
          ‹ Back
        </button>
        <div style={{ color: "var(--ink-3)", marginTop: 16 }}>Token not found.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <button onClick={onBack} style={backBtnStyle}>
          ‹ All tokens
        </button>
      </div>

      <SoftCard padding={24}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "var(--ink-3)",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{holding.name}</div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
              {formatTokenAmount(holding.amount)} {holding.symbol}
              {holding.usdAmount !== null && (
                <span style={{ marginLeft: 8 }}>· {formatUsd(holding.usdAmount)}</span>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 600,
            marginBottom: 10,
          }}
        >
          Balance by chain
        </div>
        <ChainRow holding={holding} onSend={() => onSend(key, holding.chainId)} />
      </SoftCard>
    </div>
  );
}

function ChainRow({ holding, onSend }: { holding: TokenHolding; onSend: () => void }) {
  const chain = getChain(holding.chainId);
  const isTestnet = chain?.chain.testnet ?? false;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: 12,
        background: "var(--surface-2)",
        opacity: isTestnet ? 0.65 : 1,
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: chain?.color ?? "var(--surface-edge)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: 10,
          fontWeight: 700,
          color: "#fff",
        }}
      >
        {chain?.chain.name.slice(0, 2).toUpperCase() ?? "?"}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {chain?.chain.name ?? `Chain ${holding.chainId}`}
          </span>
          {isTestnet && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--surface-edge)",
                color: "var(--ink-3)",
              }}
            >
              testnet
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
          chainId {holding.chainId}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>
          {formatTokenAmount(holding.amount)}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
          {holding.usdAmount !== null
            ? formatUsd(holding.usdAmount)
            : isTestnet
              ? "test only"
              : "—"}
        </div>
      </div>
      <button
        onClick={onSend}
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "5px 12px",
          borderRadius: 999,
          background: "var(--c-low)",
          color: "var(--c-low-ink)",
          border: 0,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Send
      </button>
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: 0,
  color: "var(--ink-2)",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "inherit",
  padding: 0,
};
