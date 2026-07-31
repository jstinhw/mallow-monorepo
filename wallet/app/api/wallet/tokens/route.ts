import { NextRequest, NextResponse } from "next/server";
import { ALCHEMY_NETWORKS } from "@/lib/constants/chains";

type AlchemyTokenPrice = {
  currency?: string | null;
  value?: string | null;
};

type AlchemyToken = {
  tokenAddress?: string | null;
  tokenBalance?: string | null;
  tokenMetadata?: {
    decimals?: number | string | null;
    name?: string | null;
    symbol?: string | null;
  } | null;
  tokenPrices?: AlchemyTokenPrice[] | null;
};

// A single holding the wallet owns on one chain, with its balance and USD
// price already resolved by Alchemy. `tokenAddress` is null for native tokens.
export type WalletToken = {
  tokenAddress: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  balance: string;
  usdPrice: number | null;
};

function alchemyApiKey(): string | null {
  return process.env.ALCHEMY_API_KEY ?? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? null;
}

function usdPriceOf(prices: AlchemyTokenPrice[] | null | undefined): number | null {
  if (!Array.isArray(prices)) return null;
  const usd = prices.find((p) => p.currency?.toLowerCase() === "usd");
  if (!usd?.value) return null;
  const value = Number(usd.value);
  return Number.isFinite(value) ? value : null;
}

function parseBalance(raw: string | null | undefined): bigint | null {
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const addr = searchParams.get("addr") ?? "";
  const chainId = Number(searchParams.get("chainId") ?? 0);

  if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    return NextResponse.json({ error: "valid addr required (0x + 40 hex chars)" }, { status: 400 });
  }
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return NextResponse.json({ error: "valid chainId required" }, { status: 400 });
  }
  const network = ALCHEMY_NETWORKS[chainId];
  if (!network) {
    return NextResponse.json({ error: "unsupported Alchemy network" }, { status: 400 });
  }
  const key = alchemyApiKey();
  if (!key) {
    return NextResponse.json({ error: "ALCHEMY_API_KEY not set" }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://api.g.alchemy.com/data/v1/${encodeURIComponent(key)}/assets/tokens/by-address`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          addresses: [{ address: addr, networks: [network] }],
          withMetadata: true,
          withPrices: true,
          includeNativeTokens: true,
          includeErc20Tokens: true,
        }),
      },
    );
    if (!res.ok) {
      return NextResponse.json({ error: "alchemy token lookup failed" }, { status: 502 });
    }
    const json = (await res.json()) as { data?: { tokens?: unknown } };
    const tokens = json.data?.tokens;
    if (!Array.isArray(tokens)) {
      return NextResponse.json({ tokens: [] });
    }

    const seen = new Map<string, WalletToken>();
    for (const token of tokens as AlchemyToken[]) {
      const balance = parseBalance(token.tokenBalance);
      if (balance === null || balance <= 0n) continue;

      const isNative = token.tokenAddress == null;
      const tokenAddress = isNative ? null : token.tokenAddress!.toLowerCase();
      const dedupeKey = tokenAddress ?? "native";
      if (seen.has(dedupeKey)) continue;

      const metadata = token.tokenMetadata ?? {};
      seen.set(dedupeKey, {
        tokenAddress,
        symbol: metadata.symbol ?? null,
        name: metadata.name ?? null,
        decimals: metadata.decimals != null ? Number(metadata.decimals) : null,
        balance: balance.toString(),
        usdPrice: usdPriceOf(token.tokenPrices),
      });
    }

    return NextResponse.json({ tokens: Array.from(seen.values()) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }
}
