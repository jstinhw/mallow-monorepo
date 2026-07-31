import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import type { GuardianInput } from "../../protocol";
import { classifySignature } from "./classify";

const PERMIT2: Address = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const TOKEN: Address = "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2";
const SPENDER: Address = "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7";
const UINT160_MAX = ((1n << 160n) - 1n).toString();
const UINT256_MAX = ((1n << 256n) - 1n).toString();

function input(typedData: GuardianInput["typedData"], to: Address = PERMIT2): GuardianInput {
  return {
    chainId: 8453,
    from: "0x0000000000000000000000000000000000000001",
    to,
    value: 0n,
    data: "0x",
    typedData,
  };
}

describe("classifySignature", () => {
  it("classifies a Permit2 PermitSingle with an unlimited amount as high risk", () => {
    const a = classifySignature(
      input({
        domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2 },
        types: {},
        primaryType: "PermitSingle",
        message: {
          details: { token: TOKEN, amount: UINT160_MAX, expiration: "1782127888", nonce: "0" },
          spender: SPENDER,
          sigDeadline: "1779537688",
        },
      }),
    );
    expect(a.kind).toBe("permit2-single");
    expect(a.spender).toBe(SPENDER);
    expect(a.token).toBe(TOKEN);
    expect(a.unlimited).toBe(true);
    expect(a.findings.map((f) => f.id)).toContain("unlimited-signed-allowance");
    expect(a.findings.find((f) => f.id === "unlimited-signed-allowance")?.severity).toBe("high");
  });

  it("classifies a bounded Permit2 PermitSingle as informational (not unlimited)", () => {
    const a = classifySignature(
      input({
        domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2 },
        types: {},
        primaryType: "PermitSingle",
        message: {
          details: { token: TOKEN, amount: "250000000", expiration: "1782127888", nonce: "0" },
          spender: SPENDER,
          sigDeadline: "1779537688",
        },
      }),
    );
    expect(a.unlimited).toBe(false);
    expect(a.amount).toBe(250000000n);
    expect(a.findings.map((f) => f.id)).toContain("signed-token-allowance");
    expect(a.findings.find((f) => f.id === "signed-token-allowance")?.severity).toBe("info");
  });

  it("classifies an ERC-2612 Permit and treats the verifying contract as the token", () => {
    const a = classifySignature(
      input(
        {
          domain: { name: "USD Coin", chainId: 8453, verifyingContract: TOKEN },
          types: {
            Permit: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "Permit",
          message: {
            owner: SPENDER,
            spender: SPENDER,
            value: UINT256_MAX,
            nonce: "0",
            deadline: "0",
          },
        },
        TOKEN,
      ),
    );
    expect(a.kind).toBe("erc2612-permit");
    expect(a.token).toBe(TOKEN);
    expect(a.unlimited).toBe(true);
  });

  it("classifies a DAI-style permit by its `allowed` boolean field", () => {
    const a = classifySignature(
      input(
        {
          domain: { name: "Dai Stablecoin", chainId: 8453, verifyingContract: TOKEN },
          types: {
            Permit: [
              { name: "holder", type: "address" },
              { name: "spender", type: "address" },
              { name: "nonce", type: "uint256" },
              { name: "expiry", type: "uint256" },
              { name: "allowed", type: "bool" },
            ],
          },
          primaryType: "Permit",
          message: { holder: SPENDER, spender: SPENDER, nonce: "0", expiry: "0", allowed: true },
        },
        TOKEN,
      ),
    );
    expect(a.kind).toBe("dai-permit");
    expect(a.unlimited).toBe(true);
  });

  it("flags a verifyingContract that differs from the contract under review", () => {
    const other: Address = "0x1111111111111111111111111111111111111111";
    const a = classifySignature(
      input(
        {
          domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2 },
          types: {},
          primaryType: "PermitSingle",
          message: {
            details: { token: TOKEN, amount: "1", expiration: "0", nonce: "0" },
            spender: SPENDER,
            sigDeadline: "0",
          },
        },
        other,
      ),
    );
    expect(a.findings.map((f) => f.id)).toContain("verifying-contract-mismatch");
  });

  it("flags a domain chainId that differs from the request chain", () => {
    const a = classifySignature(
      input({
        domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2 },
        types: {},
        primaryType: "PermitSingle",
        message: {
          details: { token: TOKEN, amount: "1", expiration: "0", nonce: "0" },
          spender: SPENDER,
          sigDeadline: "0",
        },
      }),
    );
    expect(a.findings.map((f) => f.id)).toContain("signature-chain-mismatch");
  });

  it("falls back to unknown-typed-data for an unrecognized primary type", () => {
    const a = classifySignature(
      input({
        domain: { name: "Mystery", chainId: 8453, verifyingContract: PERMIT2 },
        types: { Mystery: [{ name: "x", type: "uint256" }] },
        primaryType: "Mystery",
        message: { x: "1" },
      }),
    );
    expect(a.kind).toBe("unknown-typed-data");
    expect(a.findings.map((f) => f.id)).toContain("unclassified-typed-data");
    expect(a.findings.find((f) => f.id === "unclassified-typed-data")?.severity).toBe("medium");
  });

  it("recognizes a Permit2 signature transfer as a one-time transfer", () => {
    const a = classifySignature(
      input({
        domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2 },
        types: {},
        primaryType: "PermitTransferFrom",
        message: {
          permitted: { token: TOKEN, amount: "1000000" },
          nonce: "0",
          deadline: "1779537688",
        },
      }),
    );
    expect(a.kind).toBe("permit2-transfer");
    expect(a.token).toBe(TOKEN);
    expect(a.amount).toBe(1000000n);
    expect(a.findings.map((f) => f.id)).toContain("signed-token-transfer");
  });
});
