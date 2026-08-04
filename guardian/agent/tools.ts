import { z } from "zod";
import type { CallChain, TraceReport } from "../tools/contract-storage-tracer/src/types/report";

/** All agent tools read from a completed trace — cheap, local, no extra RPC. */
export interface AgentToolContext {
  readonly trace: TraceReport;
}

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly argsSchema: z.ZodType<unknown>;
  readonly argsHint: string;
  execute(args: unknown, ctx: AgentToolContext): unknown;
}

export type ToolResult =
  { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: string };

export interface ToolCallRecord {
  readonly round: number;
  readonly tool: string;
  readonly args: unknown;
  readonly ok: boolean;
  readonly result: unknown;
  readonly durationMs: number;
}

const MAX_CHAINS = 40;
const MAX_SLICE_CHARS = 6000;

function describeBoundedness(chain: CallChain): string {
  const b = chain.boundedness;
  switch (b.kind) {
    case "singleton":
      return `singleton: only ${b.callers.join(", ")}`;
    case "fixed-onchain":
      return `fixed-onchain: msg.sender must equal stored address ${b.caller}`;
    case "role-set":
      return `role-set: msg.sender must be in ${b.roleVar}`;
    case "unbounded":
      return `unbounded: ${b.reason}`;
  }
}

function compactChain(chain: CallChain): Record<string, unknown> {
  const guards = chain.boundedness.guards.filter((g) => g.bindsCaller).map((g) => g.expression);
  return {
    route: chain.path.join(" → "),
    op: chain.op,
    who: describeBoundedness(chain),
    ...(guards.length ? { callerBindingGuards: guards } : {}),
    provenance: chain.provenance,
  };
}

function matchesAddress(candidate: string, address: string): boolean {
  return candidate.toLowerCase() === address.toLowerCase();
}

const getCallChains: AgentTool = {
  name: "get_call_chains",
  description:
    "List every route that can touch written storage after this transaction, with who can call it (boundedness), caller-binding guards, and provenance. Optionally filter to one anchor variable.",
  argsSchema: z.object({ variable: z.string().min(1).optional() }),
  argsHint: '{"variable"?: "anchor variable or path, e.g. allowed"}',
  execute(args, ctx) {
    const { variable } = args as { variable?: string };
    const anchors = variable
      ? ctx.trace.anchors.filter((a) => a.variable === variable || a.path.startsWith(variable))
      : ctx.trace.anchors;
    if (variable && anchors.length === 0) {
      return {
        error: `no anchor matches '${variable}'; anchors: ${ctx.trace.anchors.map((a) => a.path).join(", ")}`,
      };
    }
    const chains = (variable ? anchors.flatMap((a) => a.chains) : ctx.trace.chains).map(
      compactChain,
    );
    return {
      chains: chains.slice(0, MAX_CHAINS),
      ...(chains.length > MAX_CHAINS
        ? { truncated: `${chains.length - MAX_CHAINS} more omitted` }
        : {}),
    };
  },
};

const readContractSlice: AgentTool = {
  name: "read_contract_slice",
  description:
    "Read the verified source slice of a contract in the trace, reduced to only the code that touches the written storage. Use it to judge what a route's code actually does (access control, who it pays, what it mutates).",
  argsSchema: z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }),
  argsHint: '{"address": "0x…"}',
  execute(args, ctx) {
    const { address } = args as { address: string };
    const contract = ctx.trace.compressedContracts.find((c) => matchesAddress(c.address, address));
    if (!contract) {
      return {
        error: `no compressed contract at ${address}; available: ${ctx.trace.compressedContracts.map((c) => c.address).join(", ")}`,
      };
    }
    return {
      address: contract.address,
      verified: contract.verified,
      functions: contract.functions,
      storage: contract.storage,
      sourceSlice:
        contract.sourceSlice.length > MAX_SLICE_CHARS
          ? `${contract.sourceSlice.slice(0, MAX_SLICE_CHARS)}\n…(truncated)`
          : contract.sourceSlice,
    };
  },
};

const inspectAddress: AgentTool = {
  name: "inspect_address",
  description:
    "Classify one address from the trace's address book: contract vs EOA vs unverified, activity, ENS/labels, EIP-7702 delegation, and any known-contract note. Use before judging who controls a route.",
  argsSchema: z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }),
  argsHint: '{"address": "0x…"}',
  execute(args, ctx) {
    const { address } = args as { address: string };
    const entry = ctx.trace.addresses.find((a) => matchesAddress(a.address, address));
    return (
      entry ?? {
        error: `address ${address} not in the trace's address book — it does not appear on any route`,
      }
    );
  },
};

export const AGENT_TOOLS: readonly AgentTool[] = [getCallChains, readContractSlice, inspectAddress];

export function toolByName(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

export function toolCatalog(): string {
  return AGENT_TOOLS.map((t) => `- ${t.name} args=${t.argsHint}\n  ${t.description}`).join("\n");
}

export function executeAgentTool(name: string, args: unknown, ctx: AgentToolContext): ToolResult {
  const tool = toolByName(name);
  if (!tool)
    return {
      ok: false,
      error: `unknown tool '${name}'; available: ${AGENT_TOOLS.map((t) => t.name).join(", ")}`,
    };
  const parsed = tool.argsSchema.safeParse(args ?? {});
  if (!parsed.success)
    return {
      ok: false,
      error: `invalid args for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  try {
    return { ok: true, result: tool.execute(parsed.data, ctx) };
  } catch (error) {
    return {
      ok: false,
      error: `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * The compact, LLM-facing view of a trace — everything needed to open the investigation
 * without flooding a small local model's context. Tools exist to drill into the rest.
 */
export function traceFacts(trace: TraceReport): Record<string, unknown> {
  const byBoundedness = new Map<string, number>();
  for (const c of trace.chains)
    byBoundedness.set(c.boundedness.kind, (byBoundedness.get(c.boundedness.kind) ?? 0) + 1);
  return {
    seedSummary: trace.seedSummary,
    block: trace.block,
    decoded: trace.decoded,
    observation: {
      source: trace.observation.source,
      reverted: trace.observation.reverted,
      unattributedSlots: trace.observation.unattributed.length,
    },
    coverage: trace.coverage,
    writtenVariables: trace.anchors.map((a) => ({
      path: a.path,
      valueType: a.valueType,
      access: a.access,
      verification: a.verification,
      routes: a.chains.length,
      unboundedRoutes: a.unbounded.length,
      ...(a.triage
        ? {
            triage: {
              label: a.triage.label,
              securityRelevance: a.triage.securityRelevance,
              note: "hypothesis",
            },
          }
        : {}),
    })),
    routeStats: { total: trace.chains.length, byBoundedness: Object.fromEntries(byBoundedness) },
    unboundedFrontiers: trace.unbounded.map((u) => `${u.node}: ${u.reason}`),
    addressBook: trace.addresses.map((a) => ({
      address: a.address,
      classification: a.classification,
      ...(a.ens ? { ens: a.ens } : {}),
      ...(a.labels?.length ? { labels: a.labels } : {}),
      ...(a.delegation ? { delegation: a.delegation } : {}),
      ...(a.note ? { note: a.note } : {}),
    })),
    ...(trace.hypotheses?.length
      ? {
          routeHypotheses: trace.hypotheses.map(
            (h) => `[${h.confidence}] ${h.route}: ${h.controller} — ${h.explanation}`,
          ),
        }
      : {}),
  };
}
