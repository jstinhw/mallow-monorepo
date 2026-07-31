import { describe, it, expect } from "vitest";
import { simulationFindings, type ContractLookup } from "./simulation";
import type { Address } from "viem";
import type { ContractInfo, SimulationResult, TraceCall } from "../../protocol";

const FROM = "0x96ab1eedd143ae42f8d33e9631892a890e0923a0" as Address;
const PROXY = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Address; // USDC FiatTokenProxy on Base
const IMPL = "0x2ce6311ddae708829bc0784c967b7d77d19fd779" as Address; // implementation

function baseSim(trace: TraceCall): SimulationResult {
  return {
    success: true,
    gasUsed: 45035n,
    trace,
    balanceChanges: [],
    erc20Transfers: [],
    erc721Transfers: [],
    storageDiffs: [],
  };
}

// Mirrors a USDC transfer: top-level CALL to the proxy, which DELEGATECALLs its implementation.
const proxyTransferTrace: TraceCall = {
  type: "CALL",
  from: FROM,
  to: PROXY,
  calls: [{ type: "DELEGATECALL", from: PROXY, to: IMPL }],
};

describe("simulationFindings — proxy delegatecall", () => {
  it("does not flag a verified proxy delegating to its declared implementation", () => {
    const lookup: ContractLookup = (a) =>
      a.toLowerCase() === PROXY.toLowerCase()
        ? ({ address: PROXY, verified: true, isProxy: true, implementation: IMPL } as ContractInfo)
        : null; // implementation address was never probed → unknown, like in production
    const findings = simulationFindings(baseSim(proxyTransferTrace), FROM, PROXY, lookup);
    expect(findings.find((f) => f.id === "delegatecall-to-unverified")).toBeUndefined();
  });

  it("still flags a delegatecall when the caller is NOT a verified proxy", () => {
    const lookup: ContractLookup = (a) =>
      a.toLowerCase() === PROXY.toLowerCase()
        ? ({ address: PROXY, verified: false, isProxy: false } as ContractInfo)
        : null;
    const findings = simulationFindings(baseSim(proxyTransferTrace), FROM, PROXY, lookup);
    const flag = findings.find((f) => f.id === "delegatecall-to-unverified");
    expect(flag?.severity).toBe("critical");
  });

  it("flags a verified proxy delegating somewhere OTHER than its implementation", () => {
    const evil = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Address;
    const trace: TraceCall = {
      type: "CALL",
      from: FROM,
      to: PROXY,
      calls: [{ type: "DELEGATECALL", from: PROXY, to: evil }],
    };
    const lookup: ContractLookup = (a) =>
      a.toLowerCase() === PROXY.toLowerCase()
        ? ({ address: PROXY, verified: true, isProxy: true, implementation: IMPL } as ContractInfo)
        : null;
    const findings = simulationFindings(baseSim(trace), FROM, PROXY, lookup);
    expect(findings.find((f) => f.id === "delegatecall-to-unverified")?.severity).toBe("critical");
  });
});
