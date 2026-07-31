import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../cast", () => ({
  fourByteDecode: vi.fn(async () => []),
  abiDecode: vi.fn(async () => []),
  getCode: vi.fn(async () => "0x"),
  startAnvil: vi.fn(async () => ({ proc: {}, port: 1, url: "http://anvil" })),
  simulateOnAnvil: vi.fn(async () => ({
    success: true,
    gasUsed: 21000n,
    trace: {
      type: "CALL",
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
    },
    balanceChanges: [],
    erc20Transfers: [],
    erc721Transfers: [],
    storageDiffs: [],
  })),
  shutdownAnvil: vi.fn(async () => undefined),
}));

vi.mock("../etherscan/client", () => ({
  fetchContractInfo: vi.fn(async (a: string) => ({ address: a, verified: true, isProxy: false })),
}));

vi.mock("../sourcify/client", () => ({
  lookupSignature: vi.fn(async () => []),
  _resetCache: vi.fn(),
}));

vi.mock("../llm/client", () => ({
  callGuardianActionPlanLLM: vi.fn(),
  callGuardianLLM: vi.fn(),
  callGuardianAnalyzerLLM: vi.fn(),
}));

import {
  callGuardianActionPlanLLM,
  callGuardianLLM,
  callGuardianAnalyzerLLM,
  type AssistantMessage,
} from "../llm/client";
import { fourByteDecode, getCode, simulateOnAnvil } from "../cast";
import { runGuardian } from "./check";

const mockedPlan = callGuardianActionPlanLLM as unknown as ReturnType<typeof vi.fn>;
const mockedSummarizer = callGuardianLLM as unknown as ReturnType<typeof vi.fn>;
const mockedAnalyzer = callGuardianAnalyzerLLM as unknown as ReturnType<typeof vi.fn>;
const mockedSim = simulateOnAnvil as unknown as ReturnType<typeof vi.fn>;
const mockedFourByte = fourByteDecode as unknown as ReturnType<typeof vi.fn>;
const mockedGetCode = getCode as unknown as ReturnType<typeof vi.fn>;

// Helper: build a one-shot assistant message with given tool_calls.
function assistantToolCalls(tcs: { name: string; args?: object }[]): AssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: tcs.map((t, i) => ({
      id: `call_${i}`,
      type: "function" as const,
      function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) },
    })),
  };
}

function assistantDone(content: string): AssistantMessage {
  return { role: "assistant", content, tool_calls: undefined };
}

beforeEach(() => {
  mockedPlan.mockReset();
  mockedPlan.mockResolvedValue({
    actions: ["decode_calldata", "get_contract_info", "simulate_transaction"],
    reasoning: "default",
  });
  mockedSummarizer.mockReset();
  mockedAnalyzer.mockReset();
  mockedSim.mockReset();
  mockedSim.mockResolvedValue({
    success: true,
    gasUsed: 21000n,
    trace: {
      type: "CALL",
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
    },
    balanceChanges: [],
    erc20Transfers: [],
    erc721Transfers: [],
    storageDiffs: [],
  });
  mockedFourByte.mockClear();
  mockedGetCode.mockClear();
});

const cfg = {
  rpcUrl: "https://rpc",
  etherscanKey: "k",
  llm: { baseUrl: "x", apiKey: "k", model: "m" },
};

describe("runGuardian", () => {
  it("runs the planner before the analyzer, then summarizer", async () => {
    const order: string[] = [];
    mockedPlan.mockImplementationOnce(async () => {
      order.push("plan");
      return { actions: ["simulate_transaction"], reasoning: "Need execution effects only." };
    });
    mockedAnalyzer.mockImplementationOnce(async () => {
      order.push("analyzer-1");
      return {
        message: assistantToolCalls([{ name: "simulate_transaction" }]),
        finishReason: "tool_calls" as const,
      };
    });
    mockedSim.mockImplementationOnce(async () => {
      order.push("simulate");
      return {
        success: true,
        gasUsed: 21000n,
        trace: {
          type: "CALL",
          from: "0x0000000000000000000000000000000000000001",
          to: "0x0000000000000000000000000000000000000002",
        },
        balanceChanges: [],
        erc20Transfers: [],
        erc721Transfers: [],
        storageDiffs: [],
      };
    });
    mockedAnalyzer.mockImplementationOnce(async () => {
      order.push("analyzer-2");
      return { message: assistantDone("done — looks normal"), finishReason: "stop" as const };
    });
    mockedSummarizer.mockImplementationOnce(async () => {
      order.push("summarize");
      return { summary: "ok", impacts: [], risk: "low", reasoning: "simulated" };
    });

    await runGuardian({
      input: {
        chainId: 8453,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 1n,
        data: "0xa9059cbb",
      },
      cfg,
    });

    expect(order).toEqual(["plan", "analyzer-1", "simulate", "analyzer-2", "summarize"]);
  });

  it("analyzer is autonomous — it can call tools the planner did not suggest", async () => {
    mockedPlan.mockResolvedValueOnce({
      actions: ["simulate_transaction"],
      reasoning: "Just need the simulation.",
    });
    // Analyzer ignores planner's suggestion and decodes first.
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantToolCalls([{ name: "decode_calldata" }]),
      finishReason: "tool_calls" as const,
    });
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantDone("decoded; no need to simulate"),
      finishReason: "stop" as const,
    });
    mockedSummarizer.mockResolvedValueOnce({
      summary: "ok",
      impacts: [],
      risk: "low",
      reasoning: "decoded",
    });

    await runGuardian({
      input: {
        chainId: 8453,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 0n,
        data: "0xa9059cbb000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000003e8",
      },
      cfg,
    });

    expect(mockedFourByte).toHaveBeenCalled();
    expect(mockedSim).not.toHaveBeenCalled();
  });

  it("returns a verdict for an EOA-to-EOA transfer with no LLM", async () => {
    // Planner unreachable → fallback plan; analyzer immediately stops; summarizer returns null.
    mockedPlan.mockResolvedValueOnce(null);
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantDone(""),
      finishReason: "stop" as const,
    });
    mockedSummarizer.mockResolvedValueOnce(null);
    const v = await runGuardian({
      input: {
        chainId: 8453,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 1n,
        data: "0x",
      },
      cfg,
    });
    expect(v.findings.map((f) => f.id)).toContain("pure-value-transfer");
    expect(v.llm).toBeNull();
    expect(v.summary.length).toBeGreaterThan(0);
  });

  it("max(rule, llm): does not lower below rule risk", async () => {
    // Planner suggests simulate; analyzer calls it; simulation reverts ⇒ rule risk = high.
    // Summarizer LLM tries to say "low" — final risk must remain "high".
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantToolCalls([{ name: "simulate_transaction" }]),
      finishReason: "tool_calls" as const,
    });
    mockedSim.mockResolvedValueOnce({
      success: false,
      revertReason: "boom",
      gasUsed: 0n,
      trace: {
        type: "CALL",
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
      },
      balanceChanges: [],
      erc20Transfers: [],
      erc721Transfers: [],
      storageDiffs: [],
    });
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantDone("revert observed"),
      finishReason: "stop" as const,
    });
    mockedSummarizer.mockResolvedValueOnce({
      summary: "looks fine",
      impacts: [],
      risk: "low",
      reasoning: "trust me",
    });

    const v = await runGuardian({
      input: {
        chainId: 8453,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 0n,
        data: "0x",
      },
      cfg,
    });
    expect(v.risk).toBe("high");
  });

  it("emits paired tool_start and tool_complete events", async () => {
    type Ev = {
      stage: string;
      phase?: string;
      callId?: string;
      label?: string;
      ok?: boolean;
      summary?: string;
      actions?: string[];
      reasoning?: string;
      round?: number;
      intent?: string;
      field?: string;
      text?: string;
    };
    const events: Ev[] = [];
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantToolCalls([{ name: "decode_calldata" }]),
      finishReason: "tool_calls" as const,
    });
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantDone("done"),
      finishReason: "stop" as const,
    });
    mockedSummarizer.mockResolvedValueOnce({
      summary: "ok",
      impacts: [],
      risk: "low",
      reasoning: "",
    });

    await runGuardian({
      input: {
        chainId: 8453,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 0n,
        data: "0xa9059cbb",
      },
      cfg,
      onProgress: (e) => events.push(e as Ev),
    });

    const phases = events.map((e) => `${e.stage}${e.phase ? `:${e.phase}` : ""}`);
    expect(phases).toEqual([
      "plan",
      "plan_ready",
      "analyze",
      "analyze_thinking",
      "analyze:tool_start",
      "analyze:tool_complete",
      "llm",
      "verdict",
    ]);

    const planReady = events.find((e) => e.stage === "plan_ready") as
      { stage: "plan_ready"; actions: string[]; reasoning: string } | undefined;
    expect(planReady).toBeDefined();
    expect(planReady?.actions.length).toBeGreaterThan(0);
    expect(typeof planReady?.reasoning).toBe("string");

    const thinking = events.filter((e) => e.stage === "analyze_thinking") as Array<{
      stage: "analyze_thinking";
      round: number;
      intent: string;
    }>;
    expect(thinking.length).toBeGreaterThan(0);
    expect(thinking[0].round).toBe(0);
    expect(typeof thinking[0].intent).toBe("string");
    expect(thinking[0].intent.length).toBeGreaterThan(0);

    const start = events.find((e) => e.phase === "tool_start");
    const complete = events.find((e) => e.phase === "tool_complete");
    expect(start?.callId).toBe("0-0");
    expect(start?.label).toBe("Decoded the call");
    expect(complete?.callId).toBe("0-0");
    expect(complete?.ok).toBe(true);
    expect(typeof complete?.summary).toBe("string");
  });

  it("gracefully handles a hallucinated tool name from the LLM", async () => {
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantToolCalls([{ name: "nonexistent_tool" }]),
      finishReason: "tool_calls" as const,
    });
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantDone("recovered"),
      finishReason: "stop" as const,
    });
    mockedSummarizer.mockResolvedValueOnce({
      summary: "ok",
      impacts: [],
      risk: "info",
      reasoning: "",
    });

    const v = await runGuardian({
      input: {
        chainId: 8453,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 0n,
        data: "0x",
      },
      cfg,
    });
    // No throw; runGuardian completes with a verdict.
    expect(v.risk).toBe("info");
  });

  it("classifies an EIP-712 signature request and emits a signature check + finding", async () => {
    mockedPlan.mockResolvedValueOnce({
      actions: ["get_contract_info"],
      reasoning: "Inspect the verifying contract.",
    });
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantDone("verifying contract is Permit2; spender is an unverified address"),
      finishReason: "stop" as const,
    });
    mockedSummarizer.mockResolvedValueOnce({
      summary: "Permit2 unlimited allowance",
      impacts: [],
      risk: "info",
      reasoning: "",
    });

    const v = await runGuardian({
      input: {
        chainId: 8453,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x000000000022d473030f116ddee9f6b43ac78ba3",
        value: 0n,
        data: "0x",
        typedData: {
          domain: {
            name: "Permit2",
            chainId: 8453,
            verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
          },
          types: {},
          primaryType: "PermitSingle",
          message: {
            details: {
              token: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
              amount: ((1n << 160n) - 1n).toString(),
              expiration: "1782127888",
              nonce: "0",
            },
            spender: "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7",
            sigDeadline: "1779537688",
          },
        },
      },
      cfg,
    });

    // Deterministic classification floors risk at high (unlimited allowance),
    // independent of what the LLM says.
    expect(v.risk).toBe("high");
    expect(v.findings.map((f) => f.id)).toContain("unlimited-signed-allowance");
    expect(v.findings.map((f) => f.id)).not.toContain("pure-value-transfer");
    expect(v.checks.some((c) => c.kind === "signature")).toBe(true);
    expect(v.decoded.signature).toContain("PermitSingle");
  });

  it("caps analyzer at maxRounds and forces a final text summary", async () => {
    // Every round the LLM asks for another tool; we expect 5 tool rounds then a final no-tools call.
    for (let i = 0; i < 5; i++) {
      mockedAnalyzer.mockResolvedValueOnce({
        message: assistantToolCalls([{ name: "decode_calldata" }]),
        finishReason: "tool_calls" as const,
      });
    }
    // Final forced summary call (no tools).
    mockedAnalyzer.mockResolvedValueOnce({
      message: assistantDone("hit round cap"),
      finishReason: "stop" as const,
    });
    mockedSummarizer.mockResolvedValueOnce({
      summary: "ok",
      impacts: [],
      risk: "info",
      reasoning: "",
    });

    const v = await runGuardian({
      input: {
        chainId: 8453,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 0n,
        data: "0xa9059cbb",
      },
      cfg,
    });
    expect(mockedAnalyzer).toHaveBeenCalledTimes(6); // 5 tool rounds + 1 forced summary
    expect(v).toBeDefined();
  });
});
