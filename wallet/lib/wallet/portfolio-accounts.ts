import type { Address } from "viem";
import type { TokenHolding } from "@/types/core";

export type AccountKind = "wallet" | "investment-agent";

export function splitHoldings(holdings: TokenHolding[], kind: AccountKind): TokenHolding[] {
  return kind === "wallet" ? holdings.filter((holding) => Number(holding.amount) > 0) : [];
}

export function holdingsTotal(holdings: TokenHolding[]): number {
  return holdings.reduce((sum, holding) => sum + (holding.usdAmount ?? 0), 0);
}

export function protocolLabel(id: "aave" | "morpho" | null): string {
  if (id === "aave") return "Aave V3 USDC";
  if (id === "morpho") return "Morpho USDC vault";
  return "the best USDC vault";
}

export function shortAddress(address: Address | null): string {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export type AccountAction = { kind: "send" } | { kind: "manage-agent" } | { kind: "setup-agent" };

export type AccountAvatar =
  | { kind: "wallet"; gradient: "main" }
  | { kind: "agent"; glyph: "leaf"; gradient: "sprout" | "muted" };

export type AccountChip = { symbol: string; humanAmount: string };

export type AccountBody =
  | { kind: "token-chips"; chips: AccountChip[]; moreCount: number }
  | { kind: "agent-status"; protocol: string; aprPercent: number | null }
  | { kind: "discovery"; copy: string }
  | { kind: "empty"; copy: string };

export type AccountTrailing =
  { kind: "balance"; usd: number | null; sub: string } | { kind: "none" };

export type AccountSummary = {
  kind: AccountKind;
  agentId?: string;
  name: string;
  subLabel?: string;
  avatar: AccountAvatar;
  balanceUsd: number | null;
  share: number;
  body: AccountBody;
  trailing: AccountTrailing;
  action: AccountAction;
};

export type BuildAccountSummariesInput = {
  holdings: TokenHolding[];
  totalUsdValue: number | null;
  investmentAgentAddress: Address | null;
  autoInvest: {
    enabled: boolean;
    protocolId: "aave" | "morpho" | null;
    aprPercent: number | null;
  } | null;
};

export function buildAccountSummaries(input: BuildAccountSummariesInput): AccountSummary[] {
  const mainHoldings = splitHoldings(input.holdings, "wallet");
  const mainSummary = buildMainSummary(mainHoldings);
  const agentSummary = buildAgentSummary(input.investmentAgentAddress, input.autoInvest);

  return [mainSummary, agentSummary];
}

function buildMainSummary(holdings: TokenHolding[]): AccountSummary {
  const sorted = sortHoldingsForChips(holdings);
  const hasHoldings = sorted.length > 0;
  const priced = holdings.some((h) => h.usdAmount !== null);
  const balanceUsd = !hasHoldings ? 0 : priced ? holdingsTotal(holdings) : null;

  const body: AccountBody = !hasHoldings
    ? { kind: "empty", copy: "No tokens yet" }
    : {
        kind: "token-chips",
        chips: sorted
          .slice(0, 2)
          .map((h) => ({ symbol: h.symbol, humanAmount: formatChipAmount(h) })),
        moreCount: Math.max(0, sorted.length - 2),
      };

  return {
    kind: "wallet",
    name: "Main wallet",
    avatar: { kind: "wallet", gradient: "main" },
    balanceUsd,
    // Main wallet is the only account that holds funds, so it owns the whole share.
    share: hasHoldings ? 1 : 0,
    body,
    trailing: {
      kind: "balance",
      usd: balanceUsd,
      sub: holdings.length === 1 ? "1 token" : `${holdings.length} tokens`,
    },
    action: { kind: "send" },
  };
}

// The investment agent's balance always reads as empty: the portfolio fetch is
// main-wallet only, so the agent row reflects setup/paused/active state, not funds.
function buildAgentSummary(
  address: Address | null,
  autoInvest: BuildAccountSummariesInput["autoInvest"],
): AccountSummary {
  const base = {
    kind: "investment-agent" as const,
    agentId: "yield",
    name: "Sprout",
    subLabel: "auto-invest",
    balanceUsd: null,
    share: 0,
    trailing: { kind: "none" as const },
  };

  // Discovery state — no smart account exists yet.
  if (!address) {
    return {
      ...base,
      avatar: { kind: "agent", glyph: "leaf", gradient: "muted" },
      body: { kind: "discovery", copy: "Earn ~4-5% on idle USDC, auto-managed" },
      action: { kind: "setup-agent" },
    };
  }

  // Paused state — agent exists but auto-invest is disabled.
  if (autoInvest && !autoInvest.enabled) {
    return {
      ...base,
      avatar: { kind: "agent", glyph: "leaf", gradient: "sprout" },
      body: { kind: "discovery", copy: "Paused — funds idle" },
      action: { kind: "manage-agent" },
    };
  }

  // Active state — show what it's earning.
  return {
    ...base,
    avatar: { kind: "agent", glyph: "leaf", gradient: "sprout" },
    body: {
      kind: "agent-status",
      protocol: protocolLabel(autoInvest?.protocolId ?? null),
      aprPercent: autoInvest?.aprPercent ?? null,
    },
    action: { kind: "manage-agent" },
  };
}

function sortHoldingsForChips(holdings: TokenHolding[]): TokenHolding[] {
  const allUsdNull = holdings.every((h) => h.usdAmount === null);
  return [...holdings].sort((a, b) =>
    allUsdNull ? Number(b.amount) - Number(a.amount) : (b.usdAmount ?? 0) - (a.usdAmount ?? 0),
  );
}

function formatChipAmount(holding: TokenHolding): string {
  const value = Number(holding.amount);
  if (!Number.isFinite(value) || value === 0) return "0";
  if (value < 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (value < 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
