import { describe, it, expect } from "vitest";
import { lookupSourcifySignatureTool } from "./lookup-sourcify-signature";

const summarize = lookupSourcifySignatureTool.summarizeResult;

describe("lookup_sourcify_signature summarizeResult", () => {
  it("describes a single match", () => {
    const out = summarize(
      { selector: "0xa9059cbb" },
      { selector: "0xa9059cbb", signatures: ["transfer(address,uint256)"] },
      true,
    );
    expect(out).toBe("Found: transfer(address,uint256)");
  });

  it("describes multiple matches with a count", () => {
    const out = summarize(
      { selector: "0xa9059cbb" },
      {
        selector: "0xa9059cbb",
        signatures: ["transfer(address,uint256)", "watch_tg_invmru_xxx(address,uint256)"],
      },
      true,
    );
    expect(out).toMatch(/Found 2: transfer\(address,uint256\)/);
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it("reports no matches", () => {
    const out = summarize(
      { selector: "0xdeadbeef" },
      { selector: "0xdeadbeef", signatures: [] },
      true,
    );
    expect(out).toBe("No matches for 0xdeadbeef");
  });

  it("reports failures", () => {
    const out = summarize({ selector: "0xa9059cbb" }, { error: "network" }, false);
    expect(out).toBe("Failed: network");
  });
});
