import { describe, it, expect } from "vitest";
import { synthVerdict } from "./synth";
import type { Hex } from "viem";

const base = {
  durationMs: 10,
  findings: [],
  decoded: { selector: "0xa9059cbb" as Hex },
  simulation: null,
};

describe("synthVerdict llm block", () => {
  it("carries both summarizer reasoning and analyzer prose", () => {
    const v = synthVerdict({
      ...base,
      llm: {
        summary: "Transfers 250 USDC.",
        impacts: ["−250 USDC"],
        risk: "low",
        reasoning: "Decodes as transfer.",
      },
      analyzerReasoning: "  This is a straightforward USDC transfer.  ",
    });
    expect(v.llm).toEqual({
      reasoning: "Decodes as transfer.",
      investigation: "This is a straightforward USDC transfer.",
    });
  });

  it("keeps analyzer prose even when the summarizer call fails", () => {
    const v = synthVerdict({
      ...base,
      llm: null,
      analyzerReasoning: "Clean ERC-20 transfer, no approvals.",
    });
    expect(v.llm).toEqual({ reasoning: "", investigation: "Clean ERC-20 transfer, no approvals." });
  });

  it("omits investigation when analyzer prose is blank", () => {
    const v = synthVerdict({
      ...base,
      llm: { summary: "ok", impacts: [], risk: "low", reasoning: "decoded" },
      analyzerReasoning: "   ",
    });
    expect(v.llm).toEqual({ reasoning: "decoded" });
    expect(v.llm).not.toHaveProperty("investigation");
  });

  it("is null when neither LLM output is present", () => {
    const v = synthVerdict({ ...base, llm: null });
    expect(v.llm).toBeNull();
  });

  it("carries the analyzer thinking as checkReasoning", () => {
    const v = synthVerdict({
      ...base,
      llm: { summary: "ok", impacts: [], risk: "low", reasoning: "decoded" },
      analyzerReasoning: "Clean USDC transfer.",
      analyzerThinking: "1. decoded\n2. verified\n3. simulated",
    });
    expect(v.llm).toEqual({
      reasoning: "decoded",
      investigation: "Clean USDC transfer.",
      checkReasoning: "1. decoded\n2. verified\n3. simulated",
    });
  });

  it("survives a summarizer failure but keeps analyzer prose + thinking", () => {
    const v = synthVerdict({
      ...base,
      llm: null,
      analyzerReasoning: "Clean transfer.",
      analyzerThinking: "steps...",
    });
    expect(v.llm).toEqual({
      reasoning: "",
      investigation: "Clean transfer.",
      checkReasoning: "steps...",
    });
  });
});
