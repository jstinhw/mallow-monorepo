"use client";
import type { Address } from "viem";
import { useTokenPortfolio } from "@/hooks/useTokenPortfolio";
import { useAgentPluginStatus } from "@/hooks/useAgentPluginStatus";
import { pluginSmartAccountAddress, pluginAutoInvestSnapshot } from "@/lib/agent-plugins/status";
import { useWallet } from "@/hooks/useWallet";
import { tokenKey, getChain } from "@/lib/constants/chains";
import { formatTokenAmount, formatUsd } from "@/lib/wallet/portfolio-display";
import {
  splitHoldings,
  holdingsTotal,
  protocolLabel,
  shortAddress,
  type AccountKind,
} from "@/lib/wallet/portfolio-accounts";
import { Btn, CopyButton, Glyph } from "@/components/ui";
import type { TokenHolding } from "@/types/core";

type Props = {
  onSelectToken: (key: string) => void;
  onSendToken: (key: string, chainId?: number) => void;
  onOpenAutoInvest: () => void;
};

type WalletAccount = {
  kind: AccountKind;
  name: string;
  sub: string;
  address: Address | null;
  accent: "main" | "sprout";
};

export function TokensScreen({ onSelectToken, onSendToken, onOpenAutoInvest }: Props) {
  const { state } = useWallet();
  const address: Address | null =
    state.kind === "unlocked"
      ? state.wallet.address
      : state.kind === "locked"
        ? state.address
        : null;

  const autoInvestPlugin = useAgentPluginStatus("auto-invest", address);
  const investmentAgentAddress = pluginSmartAccountAddress(autoInvestPlugin.installation);
  const autoInvestSnapshot = pluginAutoInvestSnapshot(autoInvestPlugin.status);
  const { holdings, totalUsdValue, loading, error } = useTokenPortfolio(address);

  const mainHoldings = splitHoldings(holdings, "wallet");
  const sproutHoldings = splitHoldings(holdings, "investment-agent");
  const mainTotal = holdingsTotal(mainHoldings);
  const sproutTotal = holdingsTotal(sproutHoldings);
  const combinedTotal = totalUsdValue ?? mainTotal + sproutTotal;
  const showLoadingLabel = loading && mainHoldings.length === 0 && sproutHoldings.length === 0;
  const hasSprout = !!investmentAgentAddress || sproutHoldings.length > 0;
  const currentVault = protocolLabel(autoInvestSnapshot?.protocolId ?? null);

  const accounts: WalletAccount[] = [
    {
      kind: "wallet",
      name: "Main wallet",
      sub: "Passkey",
      address,
      accent: "main",
    },
    ...(hasSprout
      ? [
          {
            kind: "investment-agent" as const,
            name: "Sprout",
            sub: "Auto-invest agent",
            address: investmentAgentAddress,
            accent: "sprout" as const,
          },
        ]
      : []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="ml-card" style={{ padding: "26px 28px" }}>
        <div className="ml-networth">
          <div>
            <div className="ml-section-label">
              Net worth · {accounts.length} account{accounts.length === 1 ? "" : "s"}
            </div>
            <div className="ml-networth-value">
              {showLoadingLabel
                ? "..."
                : Number.isFinite(combinedTotal)
                  ? formatUsd(combinedTotal)
                  : "-"}
            </div>
            <div className="ml-networth-sub">
              {hasSprout
                ? `Sprout is earning in ${currentVault}`
                : "Main wallet assets across connected chains"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn kind="ghost" size="lg" icon="arrow" onClick={() => {}}>
              Receive
            </Btn>
            <Btn kind="primary" size="lg" icon="send" onClick={() => onSendToken("")}>
              Send
            </Btn>
          </div>
        </div>

        {(mainTotal > 0 || sproutTotal > 0) && (
          <div style={{ marginTop: 22 }}>
            <div
              style={{ display: "flex", borderRadius: 999, overflow: "hidden", height: 8, gap: 3 }}
            >
              {mainTotal > 0 && (
                <div style={{ flex: mainTotal, background: "var(--acc-main-grad)" }} />
              )}
              {sproutTotal > 0 && (
                <div style={{ flex: sproutTotal, background: "var(--acc-sprout-grad)" }} />
              )}
            </div>
            <div style={{ display: "flex", gap: 22, marginTop: 10, flexWrap: "wrap" }}>
              <Legend
                color="var(--acc-main-grad)"
                label="Main wallet"
                value={formatUsd(mainTotal)}
              />
              {hasSprout && (
                <Legend
                  color="var(--acc-sprout-grad)"
                  label="Sprout"
                  value={formatUsd(sproutTotal)}
                />
              )}
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--c-crit-ink)" }}>{error}</div>
        )}
      </div>

      <div className="ml-section-label" style={{ margin: "0 4px -4px" }}>
        Accounts
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <AccountCard
          account={accounts[0]}
          holdings={mainHoldings}
          emptyLabel={loading ? "Loading main wallet..." : "No tokens in your main wallet yet."}
          onSelectToken={onSelectToken}
          onSendToken={onSendToken}
        >
          <hr
            style={{ border: 0, height: 1, background: "var(--surface-edge)", margin: "14px 0 0" }}
          />
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 14,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Btn kind="primary" icon="send" onClick={() => onSendToken("")}>
              Send
            </Btn>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Signs with passkey</span>
          </div>
        </AccountCard>

        {hasSprout && (
          <AccountCard
            account={accounts[1]}
            holdings={sproutHoldings}
            emptyLabel="No funds managed by Sprout yet."
            onSelectToken={onSelectToken}
            onSendToken={onSendToken}
            currentVault={currentVault}
          >
            <hr
              style={{
                border: 0,
                height: 1,
                background: "var(--surface-edge)",
                margin: "14px 0 0",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: 10,
                marginTop: 14,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <Btn kind="primary" icon="leaf" onClick={onOpenAutoInvest}>
                Manage agent
              </Btn>
              <Btn kind="ghost" icon="arrow" onClick={() => onSendToken("")}>
                Top up
              </Btn>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                Signs autonomously · {autoInvestSnapshot?.enabled ? "watching yields" : "paused"}
              </span>
            </div>
          </AccountCard>
        )}
      </div>
    </div>
  );
}

function AccountCard({
  account,
  holdings,
  emptyLabel,
  children,
  onSelectToken,
  onSendToken,
  currentVault,
}: {
  account: WalletAccount;
  holdings: TokenHolding[];
  emptyLabel: string;
  children: React.ReactNode;
  onSelectToken: (key: string) => void;
  onSendToken: (key: string, chainId?: number) => void;
  currentVault?: string;
}) {
  const total = holdingsTotal(holdings);
  return (
    <div className="ml-card">
      <div className="ml-account-head" style={{ marginBottom: 18 }}>
        <span
          className="ml-account-avatar"
          style={{
            background:
              account.accent === "sprout" ? "var(--acc-sprout-grad)" : "var(--acc-main-grad)",
          }}
        >
          {account.accent === "sprout" && <Glyph name="leaf" size={22} stroke={1.8} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ml-account-name">
            <span className="ml-account-name-main">{account.name}</span>
            <span className="ml-account-name-sub">· {account.sub}</span>
          </div>
          <div
            className="ml-mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 4,
              fontSize: 12,
              color: "var(--ink-3)",
              overflowWrap: "anywhere",
            }}
          >
            <span>{shortAddress(account.address)}</span>
            {account.address && <CopyButton value={account.address} size={12} />}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="ml-section-label">Balance</div>
          <div className="ml-usd" style={{ fontSize: 28, marginTop: 4 }}>
            {formatUsd(total)}
          </div>
        </div>
      </div>

      {holdings.length === 0 ? (
        <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 13 }}>{emptyLabel}</p>
      ) : (
        holdings.map((holding) => (
          <TokenRow
            key={tokenKey(holding.symbol, holding.tokenAddress)}
            holding={holding}
            accountKind={account.kind}
            currentVault={currentVault}
            onSelect={() => onSelectToken(tokenKey(holding.symbol, holding.tokenAddress))}
            onSend={() => {
              onSendToken(tokenKey(holding.symbol, holding.tokenAddress), holding.chainId);
            }}
          />
        ))
      )}
      {children}
    </div>
  );
}

function TokenRow({
  holding,
  accountKind,
  currentVault,
  onSelect,
  onSend,
}: {
  holding: TokenHolding;
  accountKind: AccountKind;
  currentVault?: string;
  onSelect: () => void;
  onSend: () => void;
}) {
  const balance = holding.amount;
  const chainNames = [holding.chainId]
    .map((chainId) => getChain(chainId)?.chain.name ?? `Chain `)
    .join(", ");
  const chainSuffix = "";
  const symbol = holding.symbol;
  const isSprout = accountKind === "investment-agent";
  const isIdleUsdc = isSprout && symbol.toUpperCase() === "USDC";

  return (
    <div
      className="ml-token-row"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
      style={{ cursor: "pointer" }}
    >
      <TokenIcon symbol={symbol} color={undefined} />
      <div style={{ minWidth: 0 }}>
        <div className="ml-token-name">{symbol}</div>
        <div className="ml-token-sub" style={{ marginTop: 2 }}>
          {isSprout ? (
            <span className={isIdleUsdc ? "ml-tag ml-tag-idle" : "ml-tag ml-tag-sprout"}>
              {!isIdleUsdc && <Glyph name="leaf" size={10} />}
              {isIdleUsdc ? "Idle" : `Earning in ${currentVault ?? "auto-invest"}`}
            </span>
          ) : (
            `${holding.name} · ${chainNames}${chainSuffix}`
          )}
        </div>
      </div>
      <div>
        <div className="ml-token-amount">{formatTokenAmount(balance)}</div>
        <div className="ml-token-usd">
          {holding.usdAmount !== null ? formatUsd(holding.usdAmount) : "-"}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSend();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 999,
          border: "1px solid var(--surface-edge-strong)",
          background: "transparent",
          color: "var(--ink-2)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        <Glyph name="send" size={11} /> Send
      </button>
    </div>
  );
}

function TokenIcon({ symbol, color }: { symbol: string; color?: string }) {
  const upper = symbol.toUpperCase();
  const cls =
    upper === "ETH"
      ? "ml-token-icon ml-token-icon-eth"
      : upper.includes("USDC") && upper !== "USDC"
        ? "ml-token-icon ml-token-icon-yield"
        : upper === "USDC"
          ? "ml-token-icon ml-token-icon-usdc"
          : "ml-token-icon";
  const label = upper.includes("USDC") && upper !== "USDC" ? "mv" : upper.slice(0, 1);
  return (
    <span className={cls} style={color ? { background: color, color: "white" } : undefined}>
      {label}
    </span>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        color: "var(--ink-2)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 999, background: color }} />
      {label}&nbsp;·&nbsp;<span className="ml-mono">{value}</span>
    </span>
  );
}
