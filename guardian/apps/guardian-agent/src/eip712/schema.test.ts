import { describe, it, expect } from "vitest";
import { typedDataSchema } from "./schema";

const validPermit2 = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    PermitSingle: [
      { name: "details", type: "PermitDetails" },
      { name: "spender", type: "address" },
      { name: "sigDeadline", type: "uint256" },
    ],
    PermitDetails: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  primaryType: "PermitSingle",
  domain: {
    name: "Permit2",
    chainId: "8453",
    verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
  },
  message: {
    details: {
      token: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
      amount: "1",
      expiration: "0",
      nonce: "0",
    },
    spender: "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7",
    sigDeadline: "0",
  },
};

describe("typedDataSchema", () => {
  it("accepts a well-formed Permit2 payload (string chainId)", () => {
    expect(typedDataSchema.safeParse(validPermit2).success).toBe(true);
  });

  it("accepts a numeric chainId", () => {
    const td = { ...validPermit2, domain: { ...validPermit2.domain, chainId: 8453 } };
    expect(typedDataSchema.safeParse(td).success).toBe(true);
  });

  it("accepts array and fixed-array member types", () => {
    const td = {
      types: {
        Mail: [
          { name: "to", type: "address[]" },
          { name: "tags", type: "bytes32[3]" },
          { name: "from", type: "Person" },
        ],
        Person: [{ name: "wallet", type: "address" }],
      },
      primaryType: "Mail",
      domain: { name: "X" },
      message: { to: [], tags: [], from: { wallet: "0x0000000000000000000000000000000000000001" } },
    };
    expect(typedDataSchema.safeParse(td).success).toBe(true);
  });

  it("rejects a payload missing a required key", () => {
    const { message: _omit, ...rest } = validPermit2;
    void _omit;
    expect(typedDataSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a primaryType that is not defined in types", () => {
    const td = { ...validPermit2, primaryType: "DoesNotExist" };
    const r = typedDataSchema.safeParse(td);
    expect(r.success).toBe(false);
    expect(r.success ? "" : r.error.issues[0].message).toContain("not defined in types");
  });

  it("rejects a member that references an undefined struct type", () => {
    const td = {
      types: { Mail: [{ name: "from", type: "Ghost" }] },
      primaryType: "Mail",
      domain: {},
      message: {},
    };
    const r = typedDataSchema.safeParse(td);
    expect(r.success).toBe(false);
    expect(r.success ? "" : r.error.issues[0].message).toContain('undefined type "Ghost"');
  });

  it("rejects an invalid type string", () => {
    const td = {
      types: { Mail: [{ name: "x", type: "uint256 evil" }] },
      primaryType: "Mail",
      domain: {},
      message: {},
    };
    expect(typedDataSchema.safeParse(td).success).toBe(false);
  });

  it("rejects a malformed verifyingContract address", () => {
    const td = { ...validPermit2, domain: { ...validPermit2.domain, verifyingContract: "0x123" } };
    expect(typedDataSchema.safeParse(td).success).toBe(false);
  });

  it("accepts a domain with non-canonical extra fields", () => {
    const td = {
      ...validPermit2,
      domain: { ...validPermit2.domain, salt: "0x" + "0".repeat(64), custom: "x" },
    };
    expect(typedDataSchema.safeParse(td).success).toBe(true);
  });
});
