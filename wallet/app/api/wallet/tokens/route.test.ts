import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Stub env before importing the route module.
vi.stubEnv("ALCHEMY_API_KEY", "test-key");

import { GET } from "./route";

const ADDR = "0x1234567890123456789012345678901234567890";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/wallet/tokens", () => {
  it("returns balances and USD prices from Alchemy Tokens By Wallet", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          tokens: [
            {
              tokenAddress: null,
              tokenBalance: "0x0de0b6b3a7640000", // 1e18
              tokenMetadata: { symbol: null, name: null, decimals: null },
              tokenPrices: [{ currency: "usd", value: "2000.5" }],
            },
            {
              tokenAddress: "0xABC",
              tokenBalance: "0x0f4240", // 1_000_000
              tokenMetadata: { symbol: "USDC", name: "USD Coin", decimals: 6 },
              tokenPrices: [{ currency: "usd", value: "0.9998" }],
            },
            {
              tokenAddress: "0xdef",
              tokenBalance: "0x0", // zero balance, filtered out
              tokenMetadata: { symbol: "LINK", name: "Chainlink", decimals: 18 },
              tokenPrices: [],
            },
          ],
        },
      }),
    });

    const req = new NextRequest(`http://localhost/api/wallet/tokens?addr=${ADDR}&chainId=42161`);
    const res = await GET(req);
    const json = await res.json();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.g.alchemy.com/data/v1/test-key/assets/tokens/by-address",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          addresses: [{ address: ADDR, networks: ["arb-mainnet"] }],
          withMetadata: true,
          withPrices: true,
          includeNativeTokens: true,
          includeErc20Tokens: true,
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(json.tokens).toEqual([
      {
        tokenAddress: null,
        symbol: null,
        name: null,
        decimals: null,
        balance: "1000000000000000000",
        usdPrice: 2000.5,
      },
      {
        tokenAddress: "0xabc",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        balance: "1000000",
        usdPrice: 0.9998,
      },
    ]);
  });

  it("deduplicates repeated Alchemy token entries", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          tokens: [
            {
              tokenAddress: "0xABC",
              tokenBalance: "0x0f4240",
              tokenMetadata: { symbol: "USDC", name: "USD Coin", decimals: 6 },
              tokenPrices: [{ currency: "usd", value: "1" }],
            },
            {
              tokenAddress: "0xabc",
              tokenBalance: "0x0f4240",
              tokenMetadata: { symbol: "USDC", name: "USD Coin", decimals: 6 },
              tokenPrices: [{ currency: "usd", value: "1" }],
            },
          ],
        },
      }),
    });

    const req = new NextRequest(`http://localhost/api/wallet/tokens?addr=${ADDR}&chainId=42161`);
    const res = await GET(req);
    const json = await res.json();

    expect(json.tokens).toEqual([
      {
        tokenAddress: "0xabc",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        balance: "1000000",
        usdPrice: 1,
      },
    ]);
  });

  it("returns empty array when Alchemy finds nothing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { tokens: [] } }),
    });

    const req = new NextRequest(`http://localhost/api/wallet/tokens?addr=${ADDR}&chainId=42161`);
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tokens).toEqual([]);
  });

  it("returns 400 when addr is missing", async () => {
    const req = new NextRequest("http://localhost/api/wallet/tokens?chainId=42161");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for unsupported Alchemy networks", async () => {
    const req = new NextRequest(`http://localhost/api/wallet/tokens?addr=${ADDR}&chainId=99999`);
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("unsupported Alchemy network");
  });
});
