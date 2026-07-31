"use client";
import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { CHAINS, getChain } from "@/lib/constants/chains";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/constants";
import type { WalletToken } from "@/app/api/wallet/tokens/route";
import type { TokenHolding } from "@/types/core";
import type { Address } from "viem";

function toHolding(token: WalletToken, chainId: number, owner: Address): TokenHolding {
  const isNative = token.tokenAddress === null;
  const chainConfig = getChain(chainId);
  if (!chainConfig) throw new Error(`Unsupported chainId: ${chainId}`);
  const native = chainConfig.chain.nativeCurrency;
  const decimals = token.decimals ?? (isNative ? native.decimals : 18);
  const amount = formatUnits(BigInt(token.balance), decimals);
  const usdAmount = token.usdPrice !== null ? Number(amount) * token.usdPrice : null;

  return {
    chainId,
    tokenAddress: isNative ? NATIVE_TOKEN_ADDRESS : (token.tokenAddress as Address),
    amount,
    decimals,
    usdAmount,
    name: token.name ?? (isNative ? native.name : "Unknown Token"),
    symbol: token.symbol ?? (isNative ? native.symbol : "UNKNOWN"),
    owner,
  };
}

async function fetchChainHoldings(address: Address, chainId: number): Promise<TokenHolding[]> {
  const res = await fetch(`/api/wallet/tokens?addr=${address}&chainId=${chainId}`);
  if (!res.ok) return [];
  const json = (await res.json()) as { tokens?: WalletToken[] };
  return (json.tokens ?? []).map((token) => toHolding(token, chainId, address));
}

export async function fetchPortfolio(address: Address): Promise<TokenHolding[]> {
  const chains = CHAINS;
  const results = await Promise.allSettled(
    chains.map((chain) => fetchChainHoldings(address, chain.chainId)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<TokenHolding[]> => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .filter((holding) => Number(holding.amount) > 0)
    .sort((a, b) => (b.usdAmount ?? 0) - (a.usdAmount ?? 0));
}

export type UseTokenPortfolioResult = {
  holdings: TokenHolding[];
  totalUsdValue: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useTokenPortfolio(address: Address | null): UseTokenPortfolioResult {
  const [holdings, setHoldings] = useState<TokenHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPortfolio(address);
      setHoldings(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "portfolio fetch failed");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await load();
      if (!cancelled) {
        timerId = setTimeout(run, 30_000);
      }
    };

    let timerId: ReturnType<typeof setTimeout>;
    void run();

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [load]);

  const totalUsdValue = holdings.some((holding) => holding.usdAmount !== null)
    ? holdings.reduce((sum, holding) => sum + (holding.usdAmount ?? 0), 0)
    : null;

  return { holdings, totalUsdValue, loading, error, refresh: load };
}
