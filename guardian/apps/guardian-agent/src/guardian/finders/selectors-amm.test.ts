import { describe, it, expect } from "vitest";
import { selectorFindings } from "./selectors";
import type { Hex } from "viem";

// AMM-specific functions (sync, skim, triggerAutoBurn, and every renamed variant
// an attacker might use) are intentionally NOT in the selector list.
//
// Reason: matching by 4-byte selector couples detection to a specific function name.
// An attacker who copies the same logic under a different name (or uses an unverified
// contract) bypasses the check entirely. Detection must come from:
//   1. get_contract_info — read the verified source and understand what the function does
//   2. simulate_transaction — observe EIP-20 burn events (Transfer to address(0))
//      and drainer patterns (tokens leave user, nothing returns)
//
// These tests document which patterns the selector layer deliberately defers to the
// LLM + simulation layer.

describe("Selector layer — EIP-standardized patterns (the only ones detected here)", () => {
  it("flags EIP-20 infinite approval (approve with type(uint256).max)", () => {
    const data = ("0x095ea7b3" +
      "00000000000000000000000010ed43c718714eb63d5aa57b78b54704e256024e" +
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") as Hex;
    const findings = selectorFindings({
      selector: "0x095ea7b3" as Hex,
      signature: "approve(address,uint256)",
      data,
    });
    expect(findings.find((f) => f.id === "infinite-approval")?.severity).toBe("high");
  });

  it("flags EIP-721 setApprovalForAll = true", () => {
    const data = ("0xa22cb465" +
      "00000000000000000000000010ed43c718714eb63d5aa57b78b54704e256024e" +
      "0000000000000000000000000000000000000000000000000000000000000001") as Hex;
    const findings = selectorFindings({
      selector: "0xa22cb465" as Hex,
      signature: "setApprovalForAll(address,bool)",
      data,
    });
    expect(findings.find((f) => f.id === "nft-blanket-approval")?.severity).toBe("high");
  });

  it("flags EIP-2612 permit (off-chain signed approval)", () => {
    const data = ("0xd505accf" + "00".repeat(224)) as Hex;
    const findings = selectorFindings({
      selector: "0xd505accf" as Hex,
      signature: "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
      data,
    });
    expect(findings.find((f) => f.id === "erc20-permit")?.severity).toBe("low");
  });
});

describe("Selector layer — AMM manipulation patterns are deliberately NOT detected here", () => {
  it("sync() produces no deterministic finding — detection requires contract source analysis", () => {
    // sync() on a UniswapV2-compatible pair resets reserve0/reserve1 to match actual
    // balances. An attacker calls it after donating tokens to lock in a manipulated
    // price. BUT: the selector 0xfff6cae9 is not in the allow-list because the same
    // logic can live under any function name. Detection: get_contract_info reads the
    // source; simulation shows storage diffs with no user asset movement → LLM flags MEDIUM.
    const findings = selectorFindings({
      selector: "0xfff6cae9" as Hex,
      signature: "sync()",
      data: "0xfff6cae9" as Hex,
    });
    expect(findings.find((f) => f.id === "amm-sync")).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it("skim() produces no deterministic finding — detection requires contract source analysis", () => {
    // skim(address) siphons tokens donated to a pair beyond its recorded reserves.
    // Same reasoning as sync(): selector match is insufficient.
    const findings = selectorFindings({
      selector: "0xbc25cf77" as Hex,
      signature: "skim(address)",
      data: ("0xbc25cf77" + "0".repeat(64)) as Hex,
    });
    expect(findings.find((f) => f.id === "amm-skim")).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  it("unknown permissionless-burn selector produces no deterministic finding", () => {
    // An attacker's custom token can expose a function that burns pair reserves under
    // any name (e.g. updateDistribution(), recycle(), executePolicy()). The 4-byte
    // selector is unknown. Detection: simulate_transaction shows ≥2 ERC-20 Transfer
    // events to address(0) → large-reserve-burn finding fires in simulation layer.
    const findings = selectorFindings({
      selector: "0xdeadbeef" as Hex,
      data: "0xdeadbeef" as Hex,
    });
    expect(findings).toHaveLength(0);
  });
});
