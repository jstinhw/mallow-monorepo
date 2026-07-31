import { describe, it, expect, vi } from "vitest";
import {
  parseWcUri,
  txParamToGuardianInput,
  classifySignature,
  requestChainId,
  buildSupportedNamespaces,
  safeHost,
  isRequestExpired,
} from "./requests";
import type { Address } from "viem";

vi.mock("@/lib/constants/chains", () => ({
  // mainnet/optimism/arbitrum intentionally have NO rpcUrl — they must still be
  // advertised over WalletConnect (connecting + signing don't need an RPC).
  CHAINS: [
    { chainId: 1, rpcUrl: null },
    { chainId: 8453, rpcUrl: "https://base" },
    { chainId: 10, rpcUrl: null },
    { chainId: 42161, rpcUrl: null },
  ],
}));

describe("parseWcUri", () => {
  it("accepts a wc: uri", () => {
    expect(parseWcUri("wc:abc@2?relay-protocol=irn&symKey=x").ok).toBe(true);
  });
  it("trims whitespace", () => {
    const r = parseWcUri("  wc:abc@2  ");
    expect(r.ok && r.uri).toBe("wc:abc@2");
  });
  it("rejects non-wc input", () => {
    expect(parseWcUri("https://foo").ok).toBe(false);
    expect(parseWcUri("").ok).toBe(false);
  });
});

describe("requestChainId", () => {
  it("parses eip155 chain string", () => {
    expect(requestChainId("eip155:8453")).toBe(8453);
  });
  it("throws on a malformed chain string", () => {
    expect(() => requestChainId("eip155:bad")).toThrow();
  });
});

describe("txParamToGuardianInput", () => {
  it("maps a full tx param", () => {
    const r = txParamToGuardianInput(
      { from: "0xaaa", to: "0xbbb", value: "0x16345785d8a0000", data: "0xdead" },
      8453,
    );
    expect(r).toEqual({
      chainId: 8453,
      from: "0xaaa",
      to: "0xbbb",
      value: 100000000000000000n,
      data: "0xdead",
    });
  });
  it("defaults missing value/data", () => {
    const r = txParamToGuardianInput({ from: "0xaaa", to: "0xbbb" }, 1);
    expect(r.value).toBe(0n);
    expect(r.data).toBe("0x");
  });
});

describe("classifySignature", () => {
  it("decodes personal_sign hex to text (params [message, address])", () => {
    const r = classifySignature("personal_sign", ["0x68656c6c6f", "0xAddr"]);
    expect(r.kind).toBe("message");
    if (r.kind === "message") {
      expect(r.account.toLowerCase()).toBe("0xaddr");
      expect(r.text).toBe("hello");
      expect(r.rawMessage).toBe("0x68656c6c6f");
    }
  });
  it("handles eth_sign param order [address, message]", () => {
    const r = classifySignature("eth_sign", ["0xAddr", "0x68656c6c6f"]);
    expect(r.kind).toBe("message");
    if (r.kind === "message") expect(r.text).toBe("hello");
  });
  it("parses signTypedData_v4 json (params [address, json])", () => {
    const typed = { domain: { name: "X" }, message: { a: 1 }, primaryType: "P", types: {} };
    const r = classifySignature("eth_signTypedData_v4", ["0xAddr", JSON.stringify(typed)]);
    expect(r.kind).toBe("typedData");
    if (r.kind === "typedData") {
      expect(r.account.toLowerCase()).toBe("0xaddr");
      expect((r.typedData as { domain: { name: string } }).domain.name).toBe("X");
    }
  });
  it("classifies eth_signTypedData (non-v4) the same as v4", () => {
    const typed = { domain: { name: "Y" }, message: {}, primaryType: "P", types: {} };
    const r = classifySignature("eth_signTypedData", ["0xAddr", JSON.stringify(typed)]);
    expect(r.kind).toBe("typedData");
  });
  it("falls back to raw string on malformed typed-data json", () => {
    const r = classifySignature("eth_signTypedData_v4", ["0xAddr", "{not json"]);
    expect(r.kind === "typedData" && r.typedData).toBe("{not json");
  });
});

describe("safeHost", () => {
  it("returns host for a valid url and falls back otherwise", () => {
    expect(safeHost("https://app.uniswap.org/x")).toBe("app.uniswap.org");
    expect(safeHost("")).toBe("unknown");
  });
});

describe("isRequestExpired", () => {
  const now = 1_779_537_000_000; // fixed "now" in ms

  it("is false when no expiry is set", () => {
    expect(isRequestExpired({}, now)).toBe(false);
  });
  it("is false when the expiry is in the future", () => {
    expect(isRequestExpired({ expiryTimestamp: 1_779_537_300 }, now)).toBe(false); // +300s
  });
  it("is true when the expiry has passed", () => {
    expect(isRequestExpired({ expiryTimestamp: 1_779_536_700 }, now)).toBe(true); // -300s
  });
  it("treats the exact expiry instant as expired", () => {
    expect(isRequestExpired({ expiryTimestamp: 1_779_537_000 }, now)).toBe(true);
  });
});

describe("buildSupportedNamespaces", () => {
  it("advertises every supported chain (incl. RPC-less ones like mainnet) with the EOA account", () => {
    const ns = buildSupportedNamespaces("0xEoa" as Address);
    expect(ns.eip155.chains).toEqual(["eip155:1", "eip155:8453", "eip155:10", "eip155:42161"]);
    expect(ns.eip155.accounts).toEqual([
      "eip155:1:0xEoa",
      "eip155:8453:0xEoa",
      "eip155:10:0xEoa",
      "eip155:42161:0xEoa",
    ]);
    expect(ns.eip155.methods).toContain("eth_sendTransaction");
    expect(ns.eip155.methods).toContain("eth_signTypedData_v4");
    expect(ns.eip155.events).toContain("chainChanged");
  });

  it("echoes back a required chain mallow does not list so the session is not rejected", () => {
    const ns = buildSupportedNamespaces("0xEoa" as Address, {
      requiredNamespaces: { eip155: { chains: ["eip155:137"] } },
    });
    expect(ns.eip155.chains).toContain("eip155:137");
    expect(ns.eip155.chains).toContain("eip155:42161");
    expect(ns.eip155.accounts).toContain("eip155:137:0xEoa");
  });

  it("includes optional-namespace chains and de-duplicates against mallow's own chains", () => {
    const ns = buildSupportedNamespaces("0xEoa" as Address, {
      requiredNamespaces: { eip155: { chains: ["eip155:1"] } },
      optionalNamespaces: { eip155: { chains: ["eip155:10", "eip155:137"] } },
    });
    expect(ns.eip155.chains).toEqual([
      "eip155:1",
      "eip155:8453",
      "eip155:10",
      "eip155:42161",
      "eip155:137",
    ]);
  });
});
