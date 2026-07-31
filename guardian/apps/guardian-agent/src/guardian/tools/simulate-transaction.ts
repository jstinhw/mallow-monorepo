import type { Address } from "viem";
import type { ContractInfo, SimulationResult, TraceCall } from "../../protocol";
import { simulateOnAnvil, invalidateAnvil } from "../../cast";
import { simulationFindings, type ContractLookup } from "../finders/simulation";
import { makeFinding } from "../risk";
import type { GuardianTool, OpenAIToolSchema, ToolContext, ToolExecuteResult } from "./types";
import { truncate } from "./text";

type SimulateArgs = Record<string, never>;

type TraceSummaryNode = {
  type: TraceCall["type"];
  to: Address;
  value?: string;
  error?: string;
  depth: number;
  callCount?: number;
};

type SimulateResult = {
  success: boolean;
  revertReason?: string;
  gasUsed: string;
  trace: TraceSummaryNode[];
  erc20Transfers: { token: Address; from: Address; to: Address; amount: string }[];
  erc721Transfers: { token: Address; from: Address; to: Address; tokenId: string }[];
  balanceDelta: { address: Address; deltaWei: string }[];
  storageDiffs: number;
  truncated: boolean;
};

const MAX_TRACE_NODES = 24;
const MAX_TRANSFERS = 10;
const MAX_BALANCE_DELTAS = 10;

const schema: OpenAIToolSchema = {
  type: "function",
  function: {
    name: "simulate_transaction",
    description:
      "Execute the transaction against a fresh Anvil fork. Answers: what actually happens on-chain — success/revert, gas, full call trace, ERC-20/721 transfers, ETH balance deltas, storage-diff count. The ground-truth signal. Expensive (~2–5s); call at most once per investigation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
};

function parseArgs(raw: unknown): SimulateArgs | null {
  if (raw === null || typeof raw !== "object") return null;
  return {} as SimulateArgs;
}

function flattenTrace(t: TraceCall, depth = 0, out: TraceSummaryNode[] = []): TraceSummaryNode[] {
  if (out.length >= MAX_TRACE_NODES) return out;
  const childCount = t.calls?.length ?? 0;
  out.push({
    type: t.type,
    to: t.to,
    value: t.value !== undefined && t.value !== 0n ? t.value.toString() : undefined,
    error: t.error,
    depth,
    callCount: childCount > 0 ? childCount : undefined,
  });
  for (const c of t.calls ?? []) {
    if (out.length >= MAX_TRACE_NODES) break;
    flattenTrace(c, depth + 1, out);
  }
  return out;
}

function summarizeForLLM(sim: SimulationResult): SimulateResult {
  const trace = flattenTrace(sim.trace);
  const truncated =
    trace.length >= MAX_TRACE_NODES ||
    sim.erc20Transfers.length > MAX_TRANSFERS ||
    sim.erc721Transfers.length > MAX_TRANSFERS ||
    sim.balanceChanges.length > MAX_BALANCE_DELTAS;
  return {
    success: sim.success,
    revertReason: sim.revertReason,
    gasUsed: sim.gasUsed.toString(),
    trace,
    erc20Transfers: sim.erc20Transfers.slice(0, MAX_TRANSFERS).map((t) => ({
      token: t.token,
      from: t.from,
      to: t.to,
      amount: t.amount.toString(),
    })),
    erc721Transfers: sim.erc721Transfers.slice(0, MAX_TRANSFERS).map((t) => ({
      token: t.token,
      from: t.from,
      to: t.to,
      tokenId: t.tokenId.toString(),
    })),
    balanceDelta: sim.balanceChanges.slice(0, MAX_BALANCE_DELTAS).map((b) => ({
      address: b.address,
      deltaWei: b.deltaWei.toString(),
    })),
    storageDiffs: sim.storageDiffs.length,
    truncated,
  };
}

function collectTraceTargets(t: TraceCall, into = new Set<Address>()): Set<Address> {
  into.add(t.to);
  for (const c of t.calls ?? []) collectTraceTargets(c, into);
  return into;
}

async function execute(
  _args: SimulateArgs,
  ctx: ToolContext,
): Promise<ToolExecuteResult<SimulateResult>> {
  try {
    let handle = await ctx.anvil.ensureStarted();
    let sim: SimulationResult;
    try {
      sim = await simulateOnAnvil(handle, {
        from: ctx.input.from,
        to: ctx.input.to,
        value: ctx.input.value,
        data: ctx.input.data,
      });
    } catch (firstErr) {
      const msg = firstErr instanceof Error ? firstErr.message : "";
      // Dead or stale fork: invalidate the warm Anvil handle and retry with a fresh fork.
      // Covers: pruned trie nodes (BSC), dead Anvil process (fetch failed / ECONNREFUSED).
      if (/missing trie node|trie|fetch failed|ECONNREFUSED|connection refused/i.test(msg)) {
        invalidateAnvil(); // clears module-level warm
        ctx.anvil.invalidateLocal(); // clears request-level cached handle
        handle = await ctx.anvil.ensureStarted();
        sim = await simulateOnAnvil(handle, {
          from: ctx.input.from,
          to: ctx.input.to,
          value: ctx.input.value,
          data: ctx.input.data,
        });
      } else {
        throw firstErr;
      }
    }

    ctx.lastSimulation = sim;

    const targets = collectTraceTargets(sim.trace);
    const lookup: ContractLookup = (a) => {
      const k = a.toLowerCase() as Address;
      if (!targets.has(a) && !targets.has(k)) return null;
      const cached = ctx.contractCache.get(k) as ContractInfo | null | undefined;
      return cached ?? null;
    };
    ctx.findings.push(
      ...simulationFindings(sim, ctx.input.from, ctx.input.to, lookup, ctx.input.value),
    );

    return { ok: true, result: summarizeForLLM(sim) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Simulation failed.";
    ctx.findings.push(
      makeFinding({
        id: "guardian-simulator-error",
        severity: "high",
        title: "Simulator error",
        detail: message,
      }),
    );
    return { ok: false, error: message };
  }
}

function plural(n: number, singular: string): string {
  return n === 1 ? `1 ${singular}` : `${n} ${singular}s`;
}

function formatGas(weiStr: string): string {
  const n = Number(weiStr);
  if (!Number.isFinite(n)) return `${weiStr} gas`;
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

function summarizeResult(
  _args: SimulateArgs | null,
  result: SimulateResult | { error: string },
  ok: boolean,
): string {
  if (!ok || "error" in result) {
    const msg = "error" in result ? result.error : "simulation failed";
    return truncate(`Failed: ${msg}`);
  }
  if (!result.success) {
    return result.revertReason ? truncate(`Reverted: ${result.revertReason}`) : "Reverted";
  }
  const parts = [`Success · gas ${formatGas(result.gasUsed)}`];
  const transfers = result.erc20Transfers.length + result.erc721Transfers.length;
  if (transfers > 0) parts.push(plural(transfers, "transfer"));
  if (result.balanceDelta.length > 0)
    parts.push(plural(result.balanceDelta.length, "balance change"));
  return truncate(parts.join(" · "));
}

export const simulateTransactionTool: GuardianTool<SimulateArgs, SimulateResult> = {
  name: schema.function.name,
  openaiToolSchema: schema,
  plannerHint:
    "simulate_transaction — answers: what actually happens on-chain when this tx runs? Use when: any contract call, or any tx where ground-truth effects matter. Cost: expensive (~2–5s); plan at most one call.",
  interpretationGuide: `## Skill: interpret simulate_transaction

success=false → hard fail. Treat as at least 'medium' risk regardless of other evidence.
success=true does NOT prove safety — a drainer simulates cleanly. Read the trace and transfers.
revertReason — verbatim revert string when available. Often human-readable (e.g. "insufficient allowance").
gasUsed (string, gas units — decimal integer) — cross-check against typical costs for the operation.
trace — flattened call list, max 24 nodes. DELEGATECALL to an unverified address is a serious risk.
erc20Transfers / erc721Transfers — the asset flow. Pay attention to direction: user receiving nothing while sending is a drainer pattern.
balanceDelta — ETH (or native) balance changes per address. The user's row tells you net ETH outflow including gas.
storageDiffs (number) — coarse signal of state churn.
truncated=true → some lists were cut off; raise risk slightly because we may be missing evidence.`,
  friendlyLabel: "Simulated transaction",
  summarizeResult,
  parseArgs,
  execute,
};
