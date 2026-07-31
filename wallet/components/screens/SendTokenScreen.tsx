"use client";
import { useState } from "react";
import {
  isAddress,
  encodeFunctionData,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
  erc20Abi,
} from "viem";
import { useTokenPortfolio } from "@/hooks/useTokenPortfolio";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";
import { useWallet } from "@/hooks/useWallet";
import { tokenKey, getChain } from "@/lib/constants/chains";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/constants";
import { Btn, SoftCard } from "@/components/ui";
import type { TokenHolding } from "@/types/core";

type Props = {
  initialTokenKey?: string | null;
  initialChainId?: number | null;
  onClose: () => void;
  onOpenItem: (id: string) => void;
};

function holdingId(holding: TokenHolding): string {
  return `${holding.chainId}:${tokenKey(holding.symbol, holding.tokenAddress)}`;
}

export function SendTokenScreen({ initialTokenKey, initialChainId, onClose, onOpenItem }: Props) {
  const { state } = useWallet();
  const wallet = state.kind === "unlocked" ? state.wallet : null;
  const { submitLive } = useApprovalQueue();
  const { holdings, loading, error } = useTokenPortfolio(wallet?.address ?? null);

  const sendableHoldings = holdings.filter((h) => Number(h.amount) > 0);
  const initialHolding =
    sendableHoldings.find(
      (h) =>
        tokenKey(h.symbol, h.tokenAddress) === initialTokenKey &&
        (initialChainId === null || initialChainId === undefined || h.chainId === initialChainId),
    ) ?? sendableHoldings[0];

  const [selectedId, setSelectedId] = useState<string>(() =>
    initialHolding ? holdingId(initialHolding) : "",
  );
  const holding = sendableHoldings.find((h) => holdingId(h) === selectedId) ?? initialHolding;
  const resolvedId = holding ? holdingId(holding) : "";

  const [to, setTo] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validTo = isAddress(to);
  const maxAmount = holding?.amount ?? "0";
  const parsedAmountNumber = Number(amountStr);
  const maxAmountNumber = Number(maxAmount);
  const validAmount =
    Number.isFinite(parsedAmountNumber) &&
    parsedAmountNumber > 0 &&
    parsedAmountNumber <= maxAmountNumber;
  const canSubmit = !!wallet && validTo && validAmount && !!holding;

  const submit = async () => {
    if (!canSubmit || !wallet || !holding) return;
    setSubmitError(null);

    try {
      const parsedAmount =
        holding.tokenAddress === NATIVE_TOKEN_ADDRESS
          ? parseEther(amountStr)
          : parseUnits(amountStr, holding.decimals);
      const intentLabel = `Send ${Number(amountStr).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${holding.symbol}`;

      if (holding.tokenAddress === NATIVE_TOKEN_ADDRESS) {
        const id = submitLive({
          from: wallet.address,
          to: to as Address,
          value: parsedAmount,
          chainId: holding.chainId,
          intent: intentLabel,
        });
        onOpenItem(id);
      } else {
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as Address, parsedAmount],
        }) as Hex;
        const id = submitLive({
          from: wallet.address,
          to: holding.tokenAddress,
          value: 0n,
          data,
          chainId: holding.chainId,
          intent: intentLabel,
        });
        onOpenItem(id);
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to build send transaction");
    }
  };

  if (!wallet) {
    return <div style={{ padding: 32 }}>Wallet locked.</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <button onClick={onClose} style={backBtnStyle}>
          ‹ Back
        </button>

        <SoftCard padding={24}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 400,
              letterSpacing: "-0.01em",
              marginBottom: 6,
            }}
          >
            Send {holding?.symbol ?? "token"}
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5, marginBottom: 20 }}>
            Guardian reviews before you sign.
          </p>

          {loading && sendableHoldings.length === 0 && <Hint kind="info">Loading balances…</Hint>}
          {!loading && sendableHoldings.length === 0 && (
            <Hint kind="error">
              {error ??
                "No tokens with on-chain balance found in this wallet. Fund it first, then come back."}
            </Hint>
          )}

          <div
            style={{ display: "grid", gap: 14, marginTop: sendableHoldings.length === 0 ? 14 : 0 }}
          >
            <Field label="Token">
              <select
                value={resolvedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={selectStyle}
                disabled={sendableHoldings.length === 0}
              >
                {sendableHoldings.length === 0 && <option value="">—</option>}
                {sendableHoldings.map((h) => (
                  <option key={holdingId(h)} value={holdingId(h)}>
                    {h.symbol} · {getChain(h.chainId)?.chain.name ?? `Chain ${h.chainId}`}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="To address">
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="0x…"
                style={inputStyle}
              />
              {to && !validTo && <Hint kind="error">Not a valid Ethereum address.</Hint>}
            </Field>

            <Field
              label="Amount"
              hint={
                maxAmount
                  ? `max ${Number(maxAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${holding?.symbol ?? ""}`
                  : undefined
              }
            >
              <div style={{ position: "relative" }}>
                <input
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  placeholder="0.0"
                  inputMode="decimal"
                  style={{ ...inputStyle, paddingRight: 52 }}
                />
                <button
                  onClick={() => setAmountStr(maxAmount)}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--accent)",
                    background: "none",
                    border: 0,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  MAX
                </button>
              </div>
              {amountStr && !validAmount && (
                <Hint kind="error">Enter an amount up to your balance.</Hint>
              )}
              {submitError && <Hint kind="error">{submitError}</Hint>}
            </Field>
          </div>

          <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
            <Btn
              kind="primary"
              icon="send"
              disabled={!canSubmit}
              onClick={() => {
                void submit();
              }}
            >
              Send to inbox
            </Btn>
            <Btn kind="ghost" onClick={onClose}>
              Cancel
            </Btn>
          </div>
        </SoftCard>
      </div>
      <div />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-3)",
          fontWeight: 600,
          letterSpacing: "0.02em",
          marginBottom: 6,
        }}
      >
        {label}
        {hint && (
          <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--ink-3)", letterSpacing: 0 }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </label>
  );
}

function Hint({ kind, children }: { kind: "error" | "info"; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 6,
        fontSize: 12,
        color: kind === "error" ? "var(--c-crit-ink)" : "var(--ink-3)",
      }}
    >
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--surface-edge)",
  background: "var(--surface-0)",
  color: "var(--ink-1)",
  fontFamily: "inherit",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
  appearance: "none",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
};

const backBtnStyle: React.CSSProperties = {
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
};
