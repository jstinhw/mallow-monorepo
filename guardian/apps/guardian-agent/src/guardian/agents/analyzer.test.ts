import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address, Hex } from "viem";
import type { GuardianInput } from "../../protocol";
import type { ToolContext } from "../tools/types";

const mocks = vi.hoisted(() => ({ callGuardianAnalyzerLLM: vi.fn() }));

vi.mock("../../llm/client", () => ({
  callGuardianAnalyzerLLM: mocks.callGuardianAnalyzerLLM,
}));

import { runAnalyzer } from "./analyzer";

const input: GuardianInput = {
  chainId: 8453,
  from: "0x96ab1eedd143ae42f8d33e9631892a890e0923a0" as Address,
  to: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as Address,
  value: 0n,
  data: "0xa9059cbb" as Hex,
};

function makeCtx(): ToolContext {
  return {
    input,
    cfg: { rpcUrl: "http://localhost:8545", etherscanKey: "" },
    contractCache: new Map(),
    findings: [],
    anvil: {
      get handle() {
        return null;
      },
      invalidateLocal() {},
      ensureStarted: async () => {
        throw new Error("unused");
      },
    },
  };
}

const cfg = { baseUrl: "x", apiKey: "k", model: "m", rpcUrl: "r", etherscanKey: "" };

describe("runAnalyzer — reasoning_content fallback", () => {
  beforeEach(() => mocks.callGuardianAnalyzerLLM.mockReset());

  it("uses reasoning_content when content is blank (truncated 'length' turn)", async () => {
    mocks.callGuardianAnalyzerLLM.mockResolvedValueOnce({
      message: {
        role: "assistant",
        content: "\n\n",
        reasoning_content: "This is a clean USDC transfer of 10 USDC.",
        tool_calls: [],
      },
      finishReason: "length",
    });
    const evidence = await runAnalyzer({
      input,
      plan: { actions: ["decode_calldata"], reasoning: "" },
      cfg,
      ctx: makeCtx(),
    });
    expect(evidence.analyzerReasoning).toBe("This is a clean USDC transfer of 10 USDC.");
    // content fell back to reasoning for the prose — don't duplicate it as the check narrative.
    expect(evidence.analyzerThinking).toBe("");
  });

  it("keeps content as the prose and reasoning_content as the check narrative", async () => {
    mocks.callGuardianAnalyzerLLM.mockResolvedValueOnce({
      message: {
        role: "assistant",
        content: "Clean transfer.",
        reasoning_content: "1. decoded\n2. verified\n3. simulated",
        tool_calls: [],
      },
      finishReason: "stop",
    });
    const evidence = await runAnalyzer({
      input,
      plan: { actions: ["decode_calldata"], reasoning: "" },
      cfg,
      ctx: makeCtx(),
    });
    expect(evidence.analyzerReasoning).toBe("Clean transfer.");
    expect(evidence.analyzerThinking).toBe("1. decoded\n2. verified\n3. simulated");
  });
});
