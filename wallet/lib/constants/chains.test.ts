import { describe, it, expect } from "vitest";
import { getChain, tokenKey, CHAINS } from "./chains";

describe("getChain", () => {
  it("returns config for a known chainId", () => {
    const chain = getChain(42161);
    expect(chain?.chain.name).toBe("Arbitrum One");
    expect(chain?.chain.testnet ?? false).toBe(false);
  });

  it("does not include testnets", () => {
    expect(CHAINS.every((chain) => !chain.chain.testnet)).toBe(true);
  });

  it("returns undefined for unknown chainId", () => {
    expect(getChain(99999)).toBeUndefined();
  });
});

describe("chain", () => {
  it("exposes a matching viem chain for supported chainIds", () => {
    expect(getChain(42161)?.chain.id).toBe(42161);
  });

  it("is undefined for unknown chainId", () => {
    expect(getChain(99999)?.chain).toBeUndefined();
  });
});

describe("tokenKey", () => {
  it("uses 'native' for null address", () => {
    expect(tokenKey("ETH", null)).toBe("ETH:native");
  });

  it("includes address for ERC-20", () => {
    expect(tokenKey("USDC", "0xabc")).toBe("USDC:0xabc");
  });
});
