import type { Address, Hex } from "viem";
import type { ContractInfo, Finding, GuardianInput, GuardianVerdict } from "../protocol";
import { startAnvil, type AnvilHandle } from "../cast";
import { fallbackPlan, runPlanner } from "./agents/planner";
import { runAnalyzer } from "./agents/analyzer";
import { runSummarizer } from "./agents/summarizer";
import { synthVerdict } from "./synth";
import { buildChecks } from "./checks";
import { makeFinding } from "./risk";
import { classifySignature, signatureCheck, type SignatureAnalysis } from "./signature";
import type { ToolContext, LazyAnvil } from "./tools/types";
import type { GuardianAction } from "../llm/schema";

export type GuardianCfg = {
  rpcUrl: string;
  etherscanKey: string;
  llm: { baseUrl: string; apiKey: string; model: string };
};

export type ToolStartEvent = {
  stage: "analyze";
  phase: "tool_start";
  callId: string;
  round: number;
  label: string;
};

export type ToolCompleteEvent = {
  stage: "analyze";
  phase: "tool_complete";
  callId: string;
  round: number;
  label: string;
  ok: boolean;
  durationMs: number;
  summary: string;
};

export type PlanReadyEvent = {
  stage: "plan_ready";
  actions: GuardianAction[];
  reasoning: string;
};

export type AnalyzeThinkingEvent = {
  stage: "analyze_thinking";
  round: number;
  intent: string;
};

export type LLMDeltaEvent = {
  stage: "llm_delta";
  field: "summary" | "reasoning";
  text: string;
};

export type ProgressEvent =
  | { stage: "plan" }
  | PlanReadyEvent
  | { stage: "analyze" }
  | AnalyzeThinkingEvent
  | ToolStartEvent
  | ToolCompleteEvent
  | { stage: "llm" }
  | LLMDeltaEvent
  | { stage: "verdict" };

export async function runGuardian(args: {
  input: GuardianInput;
  cfg: GuardianCfg;
  onProgress?: (e: ProgressEvent) => void;
}): Promise<GuardianVerdict> {
  const t0 = Date.now();
  const findings: Finding[] = [];
  const contractCache = new Map<Address, ContractInfo | null>();

  console.log(
    `[Guardian] Starting transaction analysis for target: ${args.input.to} on chain: ${args.input.chainId}`,
  );

  // EIP-712 signature request: classify what the typed data authorizes up front,
  // deterministically. This pins down the spender/token/amount and the concrete
  // outcome of signing before the LLM analyzer (which then verifies the verifying
  // contract and spender on-chain). A signature has no calldata, so the
  // pure-value-transfer branch below must not apply.
  let signatureAnalysis: SignatureAnalysis | null = null;
  if (args.input.typedData) {
    signatureAnalysis = classifySignature(args.input);
    console.log(
      `[Guardian] EIP-712 signature classified as '${signatureAnalysis.kind}' (primaryType=${signatureAnalysis.primaryType}). Outcome: ${signatureAnalysis.outcome}`,
    );
    for (const f of signatureAnalysis.findings) findings.push(f);
  } else if (args.input.data === "0x") {
    console.log("[Guardian] Input is a pure value transfer (no calldata).");
    findings.push(
      makeFinding({
        id: "pure-value-transfer",
        severity: "info",
        title: "Plain ETH transfer",
        detail: "No calldata; only ETH moves.",
      }),
    );
  }

  const anvil = makeLazyAnvil(args.cfg.rpcUrl);
  const ctx: ToolContext = {
    input: args.input,
    cfg: { rpcUrl: args.cfg.rpcUrl, etherscanKey: args.cfg.etherscanKey },
    contractCache,
    findings,
    anvil,
  };

  console.log("[Guardian] Generating analysis plan...");
  args.onProgress?.({ stage: "plan" });
  const plan = (await runPlanner({ cfg: args.cfg.llm, input: args.input })) ?? fallbackPlan();
  console.log(
    `[Guardian] Plan ready. Suggested actions: ${plan.actions.join(", ")} | Reasoning: "${plan.reasoning}"`,
  );
  args.onProgress?.({ stage: "plan_ready", actions: plan.actions, reasoning: plan.reasoning });

  console.log("[Guardian] Running analyzer...");
  args.onProgress?.({ stage: "analyze" });
  const evidence = await runAnalyzer({
    input: args.input,
    plan,
    cfg: {
      baseUrl: args.cfg.llm.baseUrl,
      apiKey: args.cfg.llm.apiKey,
      model: args.cfg.llm.model,
      rpcUrl: args.cfg.rpcUrl,
      etherscanKey: args.cfg.etherscanKey,
    },
    ctx,
    maxRounds: 5,
    onThinking: (e) => {
      console.log(`[Guardian] [Analyzer Thinking] Round ${e.round + 1}: "${e.intent}"`);
      args.onProgress?.({
        stage: "analyze_thinking",
        round: e.round,
        intent: e.intent,
      });
    },
    onToolStart: (e) => {
      console.log(
        `[Guardian] [Tool Start] Round ${e.round + 1} | Call ID: ${e.callId} | Tool: ${e.label}`,
      );
      args.onProgress?.({
        stage: "analyze",
        phase: "tool_start",
        callId: e.callId,
        round: e.round,
        label: e.label,
      });
    },
    onToolComplete: (e) => {
      console.log(
        `[Guardian] [Tool Complete] Round ${e.round + 1} | Call ID: ${e.callId} | Tool: ${e.label} | Success: ${e.ok} | Duration: ${e.durationMs}ms | Summary: "${e.summary}"`,
      );
      args.onProgress?.({
        stage: "analyze",
        phase: "tool_complete",
        callId: e.callId,
        round: e.round,
        label: e.label,
        ok: e.ok,
        durationMs: e.durationMs,
        summary: e.summary,
      });
    },
  });

  console.log(
    `[Guardian] Analyzer completed after ${evidence.roundsUsed} round(s). Running summarizer...`,
  );
  args.onProgress?.({ stage: "llm" });
  const llm = await runSummarizer({
    cfg: args.cfg.llm,
    input: args.input,
    evidence,
    plan,
    onDelta: (d) =>
      args.onProgress?.({
        stage: "llm_delta",
        field: d.field,
        text: d.text,
      }),
  });
  console.log(`[Guardian] Summarizer finished. Risk: ${llm?.risk}`);

  console.log("[Guardian] Synthesizing final verdict...");
  args.onProgress?.({ stage: "verdict" });
  // Lead the checks with the deterministic signature interpretation, and surface
  // the classified pattern in `decoded` so the UI can name it (there is no
  // calldata selector for a signature).
  const toolChecks = buildChecks(evidence.toolCalls);
  const checks = signatureAnalysis
    ? [signatureCheck(signatureAnalysis), ...toolChecks]
    : toolChecks;
  const decoded = signatureAnalysis
    ? {
        selector: "0x" as Hex,
        signature: `EIP-712 ${signatureAnalysis.primaryType}`,
        args: [signatureAnalysis.outcome],
      }
    : (evidence.decoded as { selector: Hex; signature?: string; args?: unknown[] });
  const finalVerdict = await synthVerdict({
    durationMs: Date.now() - t0,
    findings: evidence.findings,
    decoded,
    simulation: evidence.simulation,
    llm,
    analyzerReasoning: evidence.analyzerReasoning,
    analyzerThinking: evidence.analyzerThinking,
    checks,
  });

  console.log(
    `[Guardian] Completed. Final verdict risk level: ${finalVerdict.risk} in ${Date.now() - t0}ms`,
  );
  return finalVerdict;
}

function makeLazyAnvil(rpcUrl: string): LazyAnvil {
  let handle: AnvilHandle | null = null;
  let pending: Promise<AnvilHandle> | null = null;
  return {
    get handle() {
      return handle;
    },
    invalidateLocal() {
      handle = null;
    },
    async ensureStarted(): Promise<AnvilHandle> {
      if (handle) return handle;
      if (pending) return pending;
      pending = (async () => {
        const h = await startAnvil(rpcUrl);
        handle = h;
        return h;
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
