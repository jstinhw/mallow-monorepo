import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPortfolio } from "./useTokenPortfolio";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/constants";
import type { Address } from "viem";

const MAIN = "0x1111111111111111111111111111111111111111" as Address;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchPortfolio", () => {
  it("maps Alchemy balances and prices into holdings, sorted by USD value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        // Only the Arbitrum query returns tokens; other active chains return empty.
        if (url.includes("/api/wallet/tokens") && url.includes("chainId=42161")) {
          return Response.json({
            tokens: [
              {
                tokenAddress: "0xabc",
                symbol: "USDC",
                name: "USD Coin",
                decimals: 6,
                balance: "1000000", // 1 USDC
                usdPrice: 1,
              },
              {
                tokenAddress: null,
                symbol: null,
                name: null,
                decimals: null,
                balance: "1000000000000000000", // 1 native unit
                usdPrice: 2000,
              },
            ],
          });
        }
        return Response.json({ tokens: [] });
      }),
    );

    const holdings = await fetchPortfolio(MAIN);

    // Native (2000 USD) sorts ahead of USDC (1 USD); native metadata comes from
    // the chain's native currency since Alchemy returns it null.
    expect(holdings).toEqual([
      {
        chainId: 42161,
        tokenAddress: NATIVE_TOKEN_ADDRESS,
        amount: "1",
        decimals: 18,
        usdAmount: 2000,
        name: "Ether",
        symbol: "ETH",
        owner: MAIN,
      },
      {
        chainId: 42161,
        tokenAddress: "0xabc",
        amount: "1",
        decimals: 6,
        usdAmount: 1,
        name: "USD Coin",
        symbol: "USDC",
        owner: MAIN,
      },
    ]);
  });

  it("leaves usdAmount null when a token has no price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/api/wallet/tokens") && url.includes("chainId=42161")) {
          return Response.json({
            tokens: [
              {
                tokenAddress: "0xdef",
                symbol: "SPAM",
                name: "Spam Token",
                decimals: 18,
                balance: "5000000000000000000", // 5 SPAM
                usdPrice: null,
              },
            ],
          });
        }
        return Response.json({ tokens: [] });
      }),
    );

    const holdings = await fetchPortfolio(MAIN);

    expect(holdings).toEqual([
      {
        chainId: 42161,
        tokenAddress: "0xdef",
        amount: "5",
        decimals: 18,
        usdAmount: null,
        name: "Spam Token",
        symbol: "SPAM",
        owner: MAIN,
      },
    ]);
  });
});
