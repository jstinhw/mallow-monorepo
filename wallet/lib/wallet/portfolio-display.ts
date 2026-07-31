import { formatUnits } from "viem";
import type { TokenHolding } from "@/types/core";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/constants";

export function formatUsd(value: number | null | undefined, maximumFractionDigits = 0): string {
  if (value === null || value === undefined) return "—";

  const digits = value > 0 && value < 1 ? 4 : maximumFractionDigits;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: value > 0 && value < 1 ? digits : 0,
    maximumFractionDigits: digits,
  })}`;
}

export function formatTokenAmount(amount: string | number | bigint, decimals?: number): string {
  const rawAmount = typeof amount === "bigint" ? formatUnits(amount, decimals ?? 18) : amount;
  const numericAmount = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
  if (!Number.isFinite(numericAmount) || numericAmount === 0) return "0";

  if (numericAmount > 0 && numericAmount < 1) {
    const raw = typeof rawAmount === "string" ? rawAmount : numericAmount.toString();
    const [, fraction = ""] = raw.split(".");
    const trimmedFraction = fraction.replace(/0+$/, "");
    const firstNonZero = trimmedFraction.search(/[1-9]/);
    if (firstNonZero === -1) return "0";

    const decimalPlaces = Math.max(4, Math.min(trimmedFraction.length, firstNonZero + 4));
    return `0.${trimmedFraction.slice(0, decimalPlaces).padEnd(decimalPlaces, "0")}`;
  }

  return numericAmount.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function portfolioTotalLabel(
  totalUsdValue: number | null,
  holdings: TokenHolding[],
): string {
  if (totalUsdValue !== null) {
    return formatUsd(totalUsdValue);
  }

  return fallbackPortfolioBalance(holdings) ?? "—";
}

// When USD pricing is unavailable, fall back to a single token's balance — the
// native token if held, otherwise the sole holding (ambiguous when there are more).
function fallbackPortfolioBalance(holdings: TokenHolding[]): string | null {
  const withBalance = holdings.filter((holding) => Number(holding.amount) > 0);
  const holding =
    withBalance.find((item) => item.tokenAddress === NATIVE_TOKEN_ADDRESS) ??
    (withBalance.length === 1 ? withBalance[0] : null);

  return holding ? `${formatTokenAmount(holding.amount)} ${holding.symbol}` : null;
}
