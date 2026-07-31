import { describe, it, expect } from "vitest";
import { buildChecks } from "./checks";
import type { ToolCallRecord } from "./tools/types";

function rec(over: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    round: 0,
    name: "decode_calldata",
    args: {},
    result: {},
    durationMs: 1,
    ok: true,
    ...over,
  };
}

describe("buildChecks", () => {
  it("describes a resolved decode with signature, source and args", () => {
    const checks = buildChecks([
      rec({
        name: "decode_calldata",
        ok: true,
        result: {
          selector: "0xa9059cbb",
          signature: "transfer(address,uint256)",
          source: "4byte",
          args: ["0xrecipient", "1000"],
        },
      }),
    ]);
    expect(checks).toHaveLength(1);
    expect(checks[0].kind).toBe("decode");
    expect(checks[0].ok).toBe(true);
    expect(checks[0].title).toContain("transfer(address,uint256)");
    expect(checks[0].detail).toContain("0xa9059cbb");
  });

  it("marks decode unresolved when no signature came back", () => {
    const checks = buildChecks([
      rec({
        name: "decode_calldata",
        ok: true,
        result: { selector: "0xdeadbeef", source: "none" },
      }),
    ]);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].title).toContain("0xdeadbeef");
  });

  it("describes EOA target with friendly title", () => {
    const checks = buildChecks([
      rec({
        name: "get_contract_info",
        ok: true,
        result: { kind: "eoa", address: "0x0000000000000000000000000000000000000abc" },
      }),
    ]);
    expect(checks[0].kind).toBe("contract");
    expect(checks[0].title).toMatch(/EOA/);
  });

  it("marks no-code address without EOA proof as not-ok", () => {
    const checks = buildChecks([
      rec({
        name: "get_contract_info",
        ok: true,
        result: {
          kind: "empty-or-undeployed",
          address: "0x0000000000000000000000000000000000000abc",
          sentNormalTx: false,
        },
      }),
    ]);
    expect(checks[0].kind).toBe("contract");
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toContain("fresh wallet");
  });

  it("marks unverified contract as not-ok", () => {
    const checks = buildChecks([
      rec({
        name: "get_contract_info",
        ok: true,
        result: {
          kind: "contract",
          address: "0x0000000000000000000000000000000000000aaa",
          verified: false,
          isProxy: false,
        },
      }),
    ]);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toContain("NOT verified");
  });

  it("flags reverted simulation as not-ok with reason", () => {
    const checks = buildChecks([
      rec({
        name: "simulate_transaction",
        ok: true,
        result: {
          success: false,
          revertReason: "insufficient balance",
          gasUsed: "21000",
          trace: [],
          erc20Transfers: [],
          erc721Transfers: [],
          balanceDelta: [],
        },
      }),
    ]);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].title).toContain("reverted");
    expect(checks[0].detail).toContain("insufficient balance");
  });

  it("describes successful simulation with counts and gas", () => {
    const checks = buildChecks([
      rec({
        name: "simulate_transaction",
        ok: true,
        result: {
          success: true,
          gasUsed: "46823",
          trace: [{}, {}],
          erc20Transfers: [{}],
          erc721Transfers: [],
          balanceDelta: [{}],
          storageDiffs: 3,
        },
      }),
    ]);
    expect(checks[0].ok).toBe(true);
    expect(checks[0].detail).toMatch(/ERC-20 transfer/);
    expect(checks[0].detail).toMatch(/storage write/);
  });

  it("surfaces a tool error as a not-ok check", () => {
    const checks = buildChecks([
      rec({
        name: "get_contract_info",
        ok: false,
        result: { error: "getCode failed: ECONNREFUSED" },
      }),
    ]);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toContain("ECONNREFUSED");
  });

  it("skips unknown tool names", () => {
    const checks = buildChecks([rec({ name: "weird_tool" })]);
    expect(checks).toEqual([]);
  });
});
