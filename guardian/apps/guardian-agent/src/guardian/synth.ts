import type { Hex } from "viem";
import type {
  Finding,
  GuardianCheck,
  GuardianVerdict,
  SimulationResult,
  SimulationSummary,
} from "../protocol";
import { maxRisk } from "./risk";
import type { GuardianLLMOutput } from "../llm/schema";

function summarizeSimulation(sim: SimulationResult | null): SimulationSummary | null {
  if (!sim) return null;
  return {
    success: sim.success,
    revertReason: sim.revertReason,
    gasUsed: sim.gasUsed.toString(),
    erc20Transfers: sim.erc20Transfers.map((t) => ({
      token: t.token,
      from: t.from,
      to: t.to,
      amount: t.amount.toString(),
    })),
    erc721Transfers: sim.erc721Transfers.map((t) => ({
      token: t.token,
      from: t.from,
      to: t.to,
      tokenId: t.tokenId.toString(),
    })),
    balanceDelta: sim.balanceChanges.map((b) => ({
      address: b.address,
      deltaWei: b.deltaWei.toString(),
    })),
  };
}

function templatedSummary(findings: Finding[], sim: SimulationResult | null): string {
  const top = findings[0];
  if (top) return `${top.title}.${sim ? ` Simulation: ${sim.success ? "ok" : "reverts"}.` : ""}`;
  return sim ? `Simulation: ${sim.success ? "ok" : "reverts"}.` : "No findings.";
}

export function synthVerdict(args: {
  durationMs: number;
  findings: Finding[];
  decoded: { selector: Hex; signature?: string; args?: unknown[] };
  simulation: SimulationResult | null;
  llm: GuardianLLMOutput | null;
  analyzerReasoning?: string;
  analyzerThinking?: string;
  checks?: GuardianCheck[];
}): GuardianVerdict {
  const ruleRisk = maxRisk(args.findings.map((f) => f.severity));
  const finalRisk = maxRisk([ruleRisk, args.llm?.risk ?? null]);
  return {
    risk: finalRisk,
    summary: args.llm?.summary ?? templatedSummary(args.findings, args.simulation),
    impacts: args.llm?.impacts ?? [],
    findings: args.findings,
    decoded: args.decoded,
    simulation: summarizeSimulation(args.simulation),
    llm: buildLlmBlock(args.llm, args.analyzerReasoning, args.analyzerThinking),
    checks: args.checks ?? [],
    meta: { durationMs: args.durationMs, simulator: "anvil-fork" },
  };
}

// All three are LLM-generated and surface in distinct UI blocks:
//   reasoning      — summarizer's "Guardian's analysis"
//   investigation  — analyzer's prose "Guardian's full read"
//   checkReasoning — analyzer's step-by-step thinking, shown in "How Guardian checked this"
// Keep the analyzer text even when the summarizer call fails, so the verdict
// still carries a generated explanation.
function buildLlmBlock(
  llm: GuardianLLMOutput | null,
  analyzerReasoning: string | undefined,
  analyzerThinking: string | undefined,
): { reasoning: string; investigation?: string; checkReasoning?: string } | null {
  const investigation = analyzerReasoning?.trim() || undefined;
  const checkReasoning = analyzerThinking?.trim() || undefined;
  if (!llm && !investigation && !checkReasoning) return null;
  return {
    reasoning: llm?.reasoning ?? "",
    ...(investigation ? { investigation } : {}),
    ...(checkReasoning ? { checkReasoning } : {}),
  };
}
