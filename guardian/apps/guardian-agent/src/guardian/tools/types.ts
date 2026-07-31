import type { Address, Hex } from "viem";
import type { ContractInfo, Finding, GuardianInput, SimulationResult } from "../../protocol";
import type { AnvilHandle } from "../../cast";

export type OpenAIToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      additionalProperties: false;
      required: string[];
      properties: Record<string, unknown>;
    };
  };
};

export type LazyAnvil = {
  handle: AnvilHandle | null;
  ensureStarted(): Promise<AnvilHandle>;
  /** Clear the cached handle so the next ensureStarted() starts a fresh fork. */
  invalidateLocal(): void;
};

export type ToolProgressEvent = {
  kind: "tool_call";
  name: string;
  argsPreview: string;
};

export type ToolContext = {
  input: GuardianInput;
  cfg: { rpcUrl: string; etherscanKey: string };
  contractCache: Map<Address, ContractInfo | null>;
  findings: Finding[];
  anvil: LazyAnvil;
  lastDecoded?: { selector: Hex; signature?: string; args?: unknown[] };
  lastContract?: ContractInfo | null;
  lastSimulation?: SimulationResult;
  onProgress?: (e: ToolProgressEvent) => void;
};

export type ToolExecuteResult<R> = { ok: true; result: R } | { ok: false; error: string };

export type GuardianTool<ARGS, RESULT> = {
  name: string;
  openaiToolSchema: OpenAIToolSchema;
  plannerHint: string;
  interpretationGuide: string;
  friendlyLabel: string;
  summarizeResult(args: ARGS | null, result: RESULT | { error: string }, ok: boolean): string;
  parseArgs(raw: unknown): ARGS | null;
  execute(args: ARGS, ctx: ToolContext): Promise<ToolExecuteResult<RESULT>>;
};

export type AnyGuardianTool = GuardianTool<unknown, unknown>;

export type ToolCallRecord = {
  round: number;
  name: string;
  args: unknown;
  result: unknown;
  durationMs: number;
  ok: boolean;
};

export type EvidenceBundle = {
  toolCalls: ToolCallRecord[];
  findings: Finding[];
  decoded: { selector: Hex; signature?: string; args?: unknown[] };
  contract: ContractInfo | null;
  simulation: SimulationResult | null;
  analyzerReasoning: string;
  analyzerThinking: string;
  roundsUsed: number;
};
