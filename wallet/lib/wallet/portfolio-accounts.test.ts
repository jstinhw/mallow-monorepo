import { describe, expect, it } from "vitest";
import {
  splitHoldings,
  holdingsTotal,
  protocolLabel,
  shortAddress,
  buildAccountSummaries,
} from "@/lib/wallet/portfolio-accounts";
import type { Address } from "viem";
import type { TokenHolding } from "@/types/core";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/constants";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const AGENT = "0x2222222222222222222222222222222222222222" as Address;

function holding(overrides: Partial<TokenHolding> = {}): TokenHolding {
  return {
    chainId: 8453,
    tokenAddress: NATIVE_TOKEN_ADDRESS,
    amount: "1",
    decimals: 18,
    usdAmount: 4000,
    name: "Ethereum",
    symbol: "ETH",
    owner: OWNER,
    ...overrides,
  };
}

const ethMain = holding();
const usdcMain = holding({
  tokenAddress: "0xa0b8" as Address,
  amount: "2000",
  usdAmount: 2000,
  name: "USD Coin",
  symbol: "USDC",
});
const wbtcMain = holding({
  tokenAddress: "0x2260" as Address,
  amount: "0.001",
  usdAmount: 80,
  name: "Wrapped Bitcoin",
  symbol: "WBTC",
});

describe("splitHoldings", () => {
  it("returns main wallet holdings for kind=wallet", () => {
    expect(splitHoldings([ethMain], "wallet")).toEqual([ethMain]);
  });

  it("returns no investment-agent holdings because portfolio fetch is main-wallet only", () => {
    expect(splitHoldings([ethMain], "investment-agent")).toEqual([]);
  });
});

describe("holdingsTotal", () => {
  it("sums usdAmount across holdings, treating null as 0", () => {
    expect(
      holdingsTotal([
        holding({ usdAmount: 4 }),
        holding({ usdAmount: null }),
        holding({ usdAmount: 6 }),
      ]),
    ).toBe(10);
  });

  it("returns 0 for an empty list", () => {
    expect(holdingsTotal([])).toBe(0);
  });
});

describe("shortAddress", () => {
  it("returns '-' for null", () => {
    expect(shortAddress(null)).toBe("-");
  });

  it("truncates a real address to first 6 and last 4 chars", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678" as Address)).toBe(
      "0x1234...5678",
    );
  });
});

describe("protocolLabel", () => {
  it("renders aave as 'Aave V3 USDC'", () => {
    expect(protocolLabel("aave")).toBe("Aave V3 USDC");
  });
  it("renders morpho as 'Morpho USDC vault'", () => {
    expect(protocolLabel("morpho")).toBe("Morpho USDC vault");
  });
  it("falls back to 'the best USDC vault' for null", () => {
    expect(protocolLabel(null)).toBe("the best USDC vault");
  });
});

describe("buildAccountSummaries", () => {
  it("main summary has share=1 when agent has no balance", () => {
    const summaries = buildAccountSummaries({
      holdings: [ethMain, usdcMain],
      totalUsdValue: 6000,
      investmentAgentAddress: null,
      autoInvest: null,
    });
    expect(summaries).toHaveLength(2);
    expect(summaries[0].kind).toBe("wallet");
    expect(summaries[0].share).toBe(1);
    expect(summaries[0].body.kind).toBe("token-chips");
    expect(summaries[1].kind).toBe("investment-agent");
  });

  it("shows Sprout as discovery/setup even when only main wallet holdings are present", () => {
    const summaries = buildAccountSummaries({
      holdings: [ethMain, usdcMain],
      totalUsdValue: 6000,
      investmentAgentAddress: AGENT,
      autoInvest: { enabled: true, protocolId: "aave", aprPercent: 4.81 },
    });
    expect(summaries).toHaveLength(2);
    expect(summaries[0].balanceUsd).toBe(6000);
    expect(summaries[1].balanceUsd).toBeNull();
    expect(summaries[1].trailing.kind).toBe("none");
  });

  it("picks top-2 chips by USD value and counts the remainder", () => {
    const summaries = buildAccountSummaries({
      holdings: [ethMain, usdcMain, wbtcMain],
      totalUsdValue: 6080,
      investmentAgentAddress: null,
      autoInvest: null,
    });
    const main = summaries[0];
    expect(main.body.kind).toBe("token-chips");
    if (main.body.kind === "token-chips") {
      expect(main.body.chips.map((c) => c.symbol)).toEqual(["ETH", "USDC"]);
      expect(main.body.moreCount).toBe(1);
    }
  });

  it("falls back to amount sort when all USD values are null", () => {
    const summaries = buildAccountSummaries({
      holdings: [
        holding({ usdAmount: null }),
        holding({ symbol: "USDC", amount: "2000", usdAmount: null }),
      ],
      totalUsdValue: null,
      investmentAgentAddress: null,
      autoInvest: null,
    });
    const main = summaries[0];
    expect(main.balanceUsd).toBeNull();
    expect(main.body.kind).toBe("token-chips");
    if (main.body.kind === "token-chips") {
      expect(main.body.chips[0].symbol).toBe("USDC");
    }
  });

  it("renders an empty Main row when there are no holdings", () => {
    const summaries = buildAccountSummaries({
      holdings: [],
      totalUsdValue: null,
      investmentAgentAddress: AGENT,
      autoInvest: { enabled: true, protocolId: "aave", aprPercent: 4.81 },
    });
    expect(summaries[0].body.kind).toBe("empty");
    expect(summaries[0].balanceUsd).toBe(0);
  });
});
