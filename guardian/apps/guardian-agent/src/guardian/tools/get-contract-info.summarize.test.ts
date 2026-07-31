import { describe, it, expect } from "vitest";
import { getContractInfoTool } from "./get-contract-info";

const summarize = getContractInfoTool.summarizeResult;
const ADDR = "0xa0b86a33e6441b8c0dc3e4f5f0e5a8d8a8f0b3c4" as const;

describe("get_contract_info summarizeResult", () => {
  it("describes a verified named contract", () => {
    const out = summarize(
      {},
      { kind: "contract", address: ADDR, verified: true, name: "Aave v3 Pool", isProxy: false },
      true,
    );
    expect(out).toBe("Aave v3 Pool · verified");
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it("describes a verified contract with no name", () => {
    const out = summarize(
      {},
      { kind: "contract", address: ADDR, verified: true, isProxy: false },
      true,
    );
    expect(out).toBe("Verified contract");
  });

  it("flags an unverified contract", () => {
    const out = summarize(
      {},
      { kind: "contract", address: ADDR, verified: false, isProxy: false },
      true,
    );
    expect(out).toBe("Unverified contract");
  });

  it("describes an EOA recipient", () => {
    const out = summarize(
      {},
      {
        kind: "eoa",
        address: ADDR,
        sentNormalTx: true,
        sentNormalTxChainId: 1,
        checkedChainIds: [8453, 1],
        sampledNormalTxCount: 1,
        sampledInternalTxCount: 0,
      },
      true,
    );
    expect(out).toBe("EOA — sent tx on chain 1");
  });

  it("describes an EIP-7702 delegated EOA without calling it an unverified contract", () => {
    const out = summarize(
      {},
      {
        kind: "eoa",
        address: ADDR,
        sentNormalTx: true,
        sentNormalTxChainId: 8453,
        delegationCode: "0xef01000000000000000000000000000000000000000002",
        checkedChainIds: [8453],
        sampledNormalTxCount: 1,
        sampledInternalTxCount: 0,
      },
      true,
    );
    expect(out).toBe("EOA — EIP-7702 delegation, sent tx on chain 8453");
  });

  it("describes a no-code address without EOA proof", () => {
    const out = summarize(
      {},
      {
        kind: "empty-or-undeployed",
        address: ADDR,
        sentNormalTx: false,
        checkedChainIds: [8453, 1],
        sampledNormalTxCount: 0,
        sampledInternalTxCount: 0,
      },
      true,
    );
    expect(out).toBe("No code — EOA not proven");
  });

  it("reports failures", () => {
    const out = summarize({}, { error: "getCode failed: network" }, false);
    expect(out).toMatch(/^Failed: /);
    expect(out.length).toBeLessThanOrEqual(80);
  });
});
