import { describe, it, expect } from "vitest";
import { simulateTransactionTool } from "./simulate-transaction";

const summarize = simulateTransactionTool.summarizeResult;

const baseResult = {
  success: true,
  gasUsed: "184000",
  trace: [],
  erc20Transfers: [],
  erc721Transfers: [],
  balanceDelta: [],
  storageDiffs: 0,
  truncated: false,
};

describe("simulate_transaction summarizeResult", () => {
  it("describes a success with no movements", () => {
    const out = summarize({}, baseResult, true);
    expect(out).toBe("Success · gas 184k");
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it("counts ERC-20 transfers and ETH balance changes", () => {
    const out = summarize(
      {},
      {
        ...baseResult,
        gasUsed: "210500",
        erc20Transfers: [
          { token: "0x1", from: "0xa", to: "0xb", amount: "1" },
          { token: "0x2", from: "0xa", to: "0xc", amount: "2" },
        ],
        balanceDelta: [{ address: "0xa", deltaWei: "-100" }],
      },
      true,
    );
    expect(out).toMatch(/Success · gas 211k · 2 transfers · 1 balance change/);
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it("singular vs plural for one transfer", () => {
    const out = summarize(
      {},
      { ...baseResult, erc20Transfers: [{ token: "0x1", from: "0xa", to: "0xb", amount: "1" }] },
      true,
    );
    expect(out).toContain("1 transfer");
    expect(out).not.toContain("1 transfers");
  });

  it("describes a revert with the reason", () => {
    const out = summarize(
      {},
      { ...baseResult, success: false, revertReason: "insufficient allowance" },
      true,
    );
    expect(out).toBe("Reverted: insufficient allowance");
  });

  it("describes a revert without a reason", () => {
    const out = summarize({}, { ...baseResult, success: false }, true);
    expect(out).toBe("Reverted");
  });

  it("reports tool-level failure", () => {
    const out = summarize({}, { error: "Simulation failed." }, false);
    expect(out).toBe("Failed: Simulation failed.");
  });
});
