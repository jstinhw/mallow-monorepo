import { z } from "zod";
import { executeTrace } from "../tools/contract-storage-tracer/src/engine/trace";
import { createOpenAiCompatProvider } from "../tools/contract-storage-tracer/src/llm/openai-compat";
import {
  extractJsonObject,
  type ModelDelta,
  type ModelMessage,
  type ModelProvider,
  type ModelRequest,
} from "../tools/contract-storage-tracer/src/llm/provider";
import type { StepLogger } from "../tools/contract-storage-tracer/src/log";
import { seedSchema, type Seed } from "../tools/contract-storage-tracer/src/schemas/seed";
import type { TraceReport } from "../tools/contract-storage-tracer/src/types/report";
import {
  analyzerOpeningPrompt,
  analyzerSystemPrompt,
  analyzerToolResultsPrompt,
  summarizerSystemPrompt,
  summarizerUserPrompt,
} from "./prompts";
import { executeAgentTool, traceFacts, type ToolCallRecord } from "./tools";
import {
  deterministicFindings,
  synthVerdict,
  verdictLlmSchema,
  type GuardianVerdict,
  type VerdictLlmOutput,
} from "./verdict";

/**
 * The request is the EIP-1193 tx shape a wallet already holds, so it posts its object as-is —
 * `value` included: it is carried into every simulation (see `acquire/observe.ts`), so a payable
 * call is traced down the branch it actually takes.
 */
export const transactionRequestSchema = seedSchema.extend({
  anchor: z.string().optional(),
  noLlm: z.boolean().optional(),
});

export type TransactionRequest = z.infer<typeof transactionRequestSchema>;

export interface AgentEvidence {
  readonly toolCalls: readonly ToolCallRecord[];
  readonly investigation: string;
  readonly roundsUsed: number;
}

export interface AgentReport {
  readonly request: Seed;
  readonly verdict: GuardianVerdict;
  readonly evidence: AgentEvidence;
  readonly tools: {
    readonly contractStorageTracer: TraceReport;
    readonly contractStorageTracerLog: readonly string[];
  };
}

const MAX_ROUNDS = 3;
const MAX_CALLS_PER_ROUND = 3;

/**
 * Completion budgets, read from env like the rest of the model connection in `defaultProvider`,
 * because the ceiling is a property of the deployment, not of this code: a local server loads a
 * model with a fixed context (LM Studio defaults to 4096 regardless of what the weights support)
 * and refuses outright any request whose `max_tokens` exceeds it. A budget picked for a hosted
 * large-context model therefore fails 100% of the time locally — and, since the failure arrives
 * as an empty completion, used to look like a parse error rather than a rejected request.
 * Defaults fit a 4096-token context; raise both for a model served with more.
 */
const tokenBudget = (name: string, fallback: number): number => {
  const configured = Number(process.env[name]);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
};

// Also bounds a reasoning model's thinking time per call (local 27B ≈ 10-20 tok/s: 2500 ≈ 2-4 min).
const MAX_LLM_TOKENS = tokenBudget("LLM_ANALYZER_MAX_TOKENS", 2500);
// The summarizer is the one call that must succeed and reasons over the largest prompt, so it wants
// headroom — but it only gets what the served context allows, and the compact-prompt retry below
// covers the overflow. Same default as the analyzer, which this deployment is known to serve.
const SUMMARIZER_MAX_TOKENS = tokenBudget("LLM_SUMMARIZER_MAX_TOKENS", 2500);

/** Live progress hooks so a caller (e.g. the CLI) can show what's happening while the model runs. */
export interface AgentHooks {
  /** One line per pipeline step: trace done, analyzer round, tool call, summarizing. */
  readonly onProgress?: (line: string) => void;
  /** Raw streamed LLM tokens (reasoning + content) as they arrive. */
  readonly onDelta?: (delta: ModelDelta) => void;
  /**
   * Aborts the model turns when the caller goes away. Without it an abandoned check keeps the
   * gate's single model slot for minutes, so the next check queues behind a run nobody wants.
   */
  readonly signal?: AbortSignal;
}

/**
 * The model server takes one call at a time (see the gate in `llm/openai-compat`), so a second
 * concurrent check waits here. Say so, or the stream looks hung for the length of the other run.
 */
const QUEUED_LINE = "another check is using the model — queued, waiting for a slot…";

const llmHooks = (hooks: AgentHooks): Pick<ModelRequest, "onDelta" | "onQueued" | "signal"> => ({
  ...(hooks.onDelta ? { onDelta: hooks.onDelta } : {}),
  ...(hooks.onProgress ? { onQueued: () => hooks.onProgress?.(QUEUED_LINE) } : {}),
  ...(hooks.signal ? { signal: hooks.signal } : {}),
});

const analyzerActionSchema = z.object({
  intent: z.string().max(400).default(""),
  calls: z
    .array(z.object({ tool: z.string(), args: z.unknown().optional() }))
    .max(MAX_CALLS_PER_ROUND)
    .optional(),
  done: z.boolean().optional(),
  summary: z.string().max(1200).optional(),
});

export function defaultProvider(): ModelProvider {
  return createOpenAiCompatProvider({
    name: "guardian-llm",
    baseUrl:
      process.env.LMSTUDIO_BASE_URL ?? process.env.LLM_BASE_URL ?? "http://localhost:1234/v1",
    model: process.env.LMSTUDIO_MODEL ?? process.env.LLM_MODEL ?? "qwen",
    ...(process.env.LLM_API_KEY ? { apiKey: process.env.LLM_API_KEY } : {}),
  });
}

function createMemoryTraceLogger(echo?: (line: string) => void): {
  readonly logger: StepLogger;
  readonly lines: string[];
} {
  const lines: string[] = [];
  let n = 0;
  const push = (line: string): void => {
    lines.push(line);
    echo?.(line);
  };
  return {
    lines,
    logger: {
      step(msg) {
        n += 1;
        push(`[trace] ${String(n).padStart(2, " ")}. ${msg}`);
      },
      sub(msg) {
        push(`[trace]       -> ${msg}`);
      },
      note(msg) {
        push(`[trace]         * ${msg}`);
      },
      tree(msg) {
        push(`[trace]           ${msg}`);
      },
    },
  };
}

function parseAnalyzerAction(text: string): z.infer<typeof analyzerActionSchema> | null {
  try {
    return analyzerActionSchema.parse(JSON.parse(extractJsonObject(text)));
  } catch {
    return null;
  }
}

/**
 * The analyzer loop: a JSON-action protocol over plain chat completion (portable across
 * LM Studio / vLLM / Ollama / OpenAI, which disagree on native tool-call APIs). Each round
 * the model either calls up to ${MAX_CALLS_PER_ROUND} trace-reading tools or finishes with
 * a findings summary for the summarizer.
 */
export async function runAnalyzer(
  provider: ModelProvider,
  trace: TraceReport,
  facts: Record<string, unknown>,
  hooks: AgentHooks = {},
): Promise<AgentEvidence> {
  const messages: ModelMessage[] = [
    { role: "system", content: analyzerSystemPrompt(MAX_ROUNDS) },
    { role: "user", content: analyzerOpeningPrompt(facts) },
  ];
  const toolCalls: ToolCallRecord[] = [];
  let investigation = "";
  let roundsUsed = 0;
  const request = {
    temperature: 0,
    maxTokens: MAX_LLM_TOKENS,
    ...llmHooks(hooks),
  };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    roundsUsed = round;
    const t0 = Date.now();
    hooks.onProgress?.(`analyzer round ${round}/${MAX_ROUNDS} — waiting for the model…`);
    const text = await provider.complete({ ...request, messages });
    messages.push({ role: "assistant", content: text });

    let action = parseAnalyzerAction(text);
    if (!action) {
      hooks.onProgress?.(
        `analyzer round ${round} returned unparseable output — asking for JSON again`,
      );
      messages.push({
        role: "user",
        content: "That was not parseable JSON. Respond with the JSON object only.",
      });
      const retry = await provider.complete({ ...request, messages });
      messages.push({ role: "assistant", content: retry });
      action = parseAnalyzerAction(retry);
      if (!action) break;
    }

    if (action.done || !action.calls?.length) {
      investigation = action.summary ?? action.intent;
      hooks.onProgress?.(
        `analyzer finished in round ${round} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
      );
      break;
    }

    hooks.onProgress?.(
      `analyzer round ${round} (${((Date.now() - t0) / 1000).toFixed(1)}s): ${action.intent || "calling tools"}`,
    );
    const results = action.calls.map((call) => {
      const start = Date.now();
      const outcome = executeAgentTool(call.tool, call.args, { trace });
      const payload = outcome.ok ? outcome.result : { error: outcome.error };
      toolCalls.push({
        round,
        tool: call.tool,
        args: call.args ?? {},
        ok: outcome.ok,
        result: payload,
        durationMs: Date.now() - start,
      });
      hooks.onProgress?.(`tool ${call.tool} ${outcome.ok ? "ok" : "error"}`);
      return { tool: call.tool, payload };
    });
    messages.push({ role: "user", content: analyzerToolResultsPrompt(results) });
  }

  return { toolCalls, investigation, roundsUsed };
}

export async function runSummarizer(
  provider: ModelProvider,
  args: {
    readonly seed: Seed;
    readonly facts: Record<string, unknown>;
    readonly findings: ReturnType<typeof deterministicFindings>;
    readonly evidence: AgentEvidence;
    readonly traceLog: readonly string[];
  },
  hooks: AgentHooks = {},
): Promise<VerdictLlmOutput> {
  const ask = (userContent: string): Promise<VerdictLlmOutput> =>
    provider.respondJson(
      {
        temperature: 0,
        maxTokens: SUMMARIZER_MAX_TOKENS,
        ...llmHooks(hooks),
        messages: [
          { role: "system", content: summarizerSystemPrompt() },
          { role: "user", content: userContent },
        ],
      },
      verdictLlmSchema,
    );

  hooks.onProgress?.("summarizing verdict — waiting for the model…");
  try {
    return await ask(
      summarizerUserPrompt({
        seed: args.seed,
        facts: args.facts,
        findings: args.findings,
        toolCalls: args.evidence.toolCalls,
        investigation: args.evidence.investigation,
        traceLog: args.traceLog,
      }),
    );
  } catch (error) {
    // A reasoning model can burn its whole budget deliberating over the full evidence dump.
    // Retry once with a compact prompt (facts + findings only) that leaves far less to ponder.
    hooks.onProgress?.(
      `summarizer attempt 1 failed (${error instanceof Error ? error.message : String(error)}) — retrying with a compact prompt`,
    );
    return ask(
      summarizerUserPrompt({
        seed: args.seed,
        facts: args.facts,
        findings: args.findings,
        toolCalls: [],
        investigation: args.evidence.investigation,
        traceLog: [],
      }),
    );
  }
}

/**
 * The guardian pipeline over contract-storage-tracer only:
 *   trace (deterministic, evidence round 0) → analyzer (LLM tool loop over the trace)
 *   → summarizer (LLM verdict) → synth (deterministic findings set the risk floor).
 * Degrades cleanly: with --no-llm or an unreachable model, the verdict is the
 * deterministic floor with a templated summary — never a thrown error.
 */
export async function analyzeTransactionRequest(
  input: unknown,
  options: AgentHooks & { readonly provider?: ModelProvider } = {},
): Promise<AgentReport> {
  const request = transactionRequestSchema.parse(input);
  const { anchor, noLlm, ...seed } = request;
  const t0 = Date.now();

  const log = createMemoryTraceLogger(options.onProgress && ((line) => options.onProgress?.(line)));
  options.onProgress?.("tracing storage writes (deterministic)…");
  // The tracer's internal advisory LLM (anchor triage / opaque hypotheses) is always off here:
  // this agent's analyzer+summarizer IS the advisory layer, and doubling it doubles model latency.
  const trace = await executeTrace(
    seed,
    { ...(anchor ? { anchorFilter: anchor } : {}), noLlm: true },
    log.logger,
  );
  const traceMs = Date.now() - t0;
  options.onProgress?.(
    `trace done in ${(traceMs / 1000).toFixed(1)}s — ${trace.anchors.length} written variable${trace.anchors.length === 1 ? "" : "s"}, ${trace.chains.length} routes, coverage ${trace.coverage.kind}`,
  );

  const facts = traceFacts(trace);
  const findings = deterministicFindings(trace);
  const traceCall: ToolCallRecord = {
    round: 0,
    tool: "trace_storage_writes",
    args: {
      chainId: seed.chainId,
      from: seed.from,
      to: seed.to,
      selector: trace.decoded.selector,
      ...(seed.value !== undefined ? { value: seed.value } : {}),
    },
    ok: true,
    result: { seedSummary: trace.seedSummary, coverage: trace.coverage.kind },
    durationMs: traceMs,
  };

  let evidence: AgentEvidence = { toolCalls: [traceCall], investigation: "", roundsUsed: 0 };
  let llm: VerdictLlmOutput | null = null;
  if (!noLlm) {
    const model = options.provider ?? defaultProvider();
    try {
      const analyzed = await runAnalyzer(model, trace, facts, options);
      evidence = { ...analyzed, toolCalls: [traceCall, ...analyzed.toolCalls] };
    } catch (error) {
      // analyzer unavailable — the summarizer still gets the full deterministic facts
      options.onProgress?.(
        `analyzer unavailable (${error instanceof Error ? error.message : String(error)}) — continuing with deterministic facts`,
      );
    }
    try {
      llm = await runSummarizer(
        model,
        { seed, facts, findings, evidence, traceLog: log.lines },
        options,
      );
    } catch (error) {
      llm = null; // summarizer unavailable — synth falls back to the deterministic floor
      options.onProgress?.(
        `summarizer unavailable (${error instanceof Error ? error.message : String(error)}) — using the deterministic verdict`,
      );
    }
  }
  options.onProgress?.(`verdict ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const verdict = synthVerdict({
    trace,
    findings,
    llm,
    ...(evidence.investigation ? { investigation: evidence.investigation } : {}),
    durationMs: Date.now() - t0,
    roundsUsed: evidence.roundsUsed,
  });

  return {
    request: seed,
    verdict,
    evidence,
    tools: { contractStorageTracer: trace, contractStorageTracerLog: log.lines },
  };
}
