import { describe, it, expect } from "vitest";
import { decodeCalldataTool } from "./decode-calldata";

const summarize = decodeCalldataTool.summarizeResult;

describe("decode_calldata summarizeResult", () => {
  it("returns the resolved signature", () => {
    const out = summarize(
      { data: undefined },
      {
        selector: "0xa9059cbb",
        signature: "transfer(address,uint256)",
        args: ["0xabc1234567890abcdef1234567890abcdef12345", "1000"],
        source: "4byte",
      },
      true,
    );
    expect(out).toMatch(/transfer\(address,uint256\)/);
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it("falls back to the selector when signature is unknown", () => {
    const out = summarize({}, { selector: "0xdeadbeef", source: "none" }, true);
    expect(out).toBe("Unknown selector 0xdeadbeef");
  });

  it("describes the empty-calldata case", () => {
    const out = summarize({}, { selector: "0x", source: "empty" }, true);
    expect(out).toBe("No calldata (plain ETH transfer)");
  });

  it("reports failures with the error message", () => {
    const out = summarize({}, { error: "calldata too short to contain a selector" }, false);
    expect(out).toMatch(/^Failed: /);
    expect(out).toContain("too short");
    expect(out.length).toBeLessThanOrEqual(80);
  });
});
