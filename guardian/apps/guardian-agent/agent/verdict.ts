import { z } from "zod"
import type { TraceReport, UnboundedFrontier } from "../tools/contract-storage-tracer/src/types/report"

export const RISK_LEVELS = ["info", "low", "medium", "high", "critical"] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

/** What the user should do, derived from risk: sign now, review first, or refuse. */
export type Decision = "sign" | "review" | "reject"

export interface Finding {
  readonly id: string
  readonly severity: RiskLevel
  readonly title: string
  readonly detail: string
}

export interface VerdictCheck {
  readonly kind: "decode" | "observe" | "reach" | "address"
  readonly ok: boolean
  readonly title: string
  readonly detail: string
}

/**
 * The summarizer LLM's contribution to the verdict. Maximums are roomy on purpose:
 * the prompt asks for tighter targets, and the schema only rejects junk — a slightly
 * verbose verdict must not silently degrade to the templated fallback.
 */
export const verdictLlmSchema = z.object({
  risk: z.enum(RISK_LEVELS),
  summary: z.string().min(20).max(800),
  impacts: z.array(z.string().min(6).max(400)).min(1).max(8),
  reasoning: z.string().min(40).max(3000),
})
export type VerdictLlmOutput = z.infer<typeof verdictLlmSchema>

export interface GuardianVerdict {
  readonly risk: RiskLevel
  readonly decision: Decision
  readonly summary: string
  readonly impacts: readonly string[]
  readonly findings: readonly Finding[]
  readonly checks: readonly VerdictCheck[]
  readonly decoded: TraceReport["decoded"]
  readonly coverage: TraceReport["coverage"]
  readonly llm: { readonly reasoning: string; readonly investigation?: string } | null
  readonly meta: {
    readonly durationMs: number
    readonly block: number
    readonly roundsUsed: number
    readonly tracer: "contract-storage-tracer"
  }
}

export function maxRisk(levels: readonly (RiskLevel | null | undefined)[]): RiskLevel {
  const highest = levels.reduce<number>((max, level) => Math.max(max, level ? RISK_LEVELS.indexOf(level) : 0), 0)
  return RISK_LEVELS[highest] ?? "info"
}

export function decisionFor(risk: RiskLevel): Decision {
  if (risk === "info" || risk === "low") return "sign"
  if (risk === "medium") return "review"
  return "reject"
}

function dedupeFrontiers(frontiers: readonly UnboundedFrontier[]): readonly UnboundedFrontier[] {
  const seen = new Map<string, UnboundedFrontier>()
  for (const f of frontiers) if (!seen.has(f.node)) seen.set(f.node, f)
  return [...seen.values()]
}

/**
 * Deterministic risk floor derived from the trace alone. Rules are capability-based
 * (coverage, verification, reach) — never keyed to function names, selectors, or protocols.
 * The LLM can raise the final risk above this floor but never lower it.
 */
export function deterministicFindings(trace: TraceReport): readonly Finding[] {
  const findings: Finding[] = []

  if (trace.observation.reverted) {
    findings.push({
      id: "seed-call-reverts",
      severity: "medium",
      title: "Transaction reverts at the pinned block",
      detail: "The call fails as submitted; written variables are static hypotheses, not observed writes.",
    })
  }

  if (trace.decoded.source === "unknown") {
    findings.push({
      id: "calldata-undecoded",
      severity: "medium",
      title: "Calldata could not be decoded",
      detail: `Selector ${trace.decoded.selector} matches no ABI or signature-database entry; intent is opaque.`,
    })
  }

  const unverified = trace.addresses.filter((a) => a.classification === "unverified")
  if (unverified.length > 0) {
    findings.push({
      id: "unverified-contract-in-reach",
      severity: "medium",
      title: `${unverified.length} unverified contract${unverified.length === 1 ? "" : "s"} can reach written storage`,
      detail: unverified.map((a) => a.address).join(", "),
    })
  }

  const unboundedWrites = dedupeFrontiers(trace.unbounded)
  if (unboundedWrites.length > 0) {
    findings.push({
      id: "unbounded-frontiers",
      severity: "low",
      title: `${unboundedWrites.length} route${unboundedWrites.length === 1 ? "" : "s"} to written storage could not be caller-bounded`,
      detail: unboundedWrites.map((f) => `${f.node}: ${f.reason}`).join("; "),
    })
  }

  if (trace.observation.unattributed.length > 0) {
    findings.push({
      id: "unattributed-slots",
      severity: "low",
      title: `${trace.observation.unattributed.length} touched slot${trace.observation.unattributed.length === 1 ? "" : "s"} not attributed to a variable`,
      detail: trace.observation.unattributed.map((s) => s.slot).join(", "),
    })
  }

  findings.push({
    id: "written-variables",
    severity: "info",
    title: trace.anchors.length === 0 ? "No attributable storage writes" : `Writes ${trace.anchors.length} storage variable${trace.anchors.length === 1 ? "" : "s"}`,
    detail: trace.anchors.length === 0 ? "The call writes no storage the tracer could attribute." : trace.anchors.map((a) => a.path).join(", "),
  })

  return findings
}

export function buildChecks(trace: TraceReport): readonly VerdictCheck[] {
  const observed = trace.anchors.filter((a) => a.verification === "observed-write").length
  const unverified = trace.addresses.filter((a) => a.classification === "unverified").length
  return [
    {
      kind: "decode",
      ok: trace.decoded.source !== "unknown",
      title: "Calldata decoded",
      detail: `${trace.decoded.functionName} (${trace.decoded.selector}) via ${trace.decoded.source}`,
    },
    {
      kind: "observe",
      ok: !trace.observation.reverted,
      title: "Storage writes observed",
      detail: `${trace.observation.source}${trace.observation.reverted ? " · call reverts" : ""} · ${observed}/${trace.anchors.length} anchors observed on-chain`,
    },
    {
      kind: "reach",
      ok: trace.coverage.kind === "complete",
      title: "Follow-up reach bounded",
      detail: `${trace.chains.length} chains · ${dedupeFrontiers(trace.unbounded).length} unbounded frontiers · coverage ${trace.coverage.kind}`,
    },
    {
      kind: "address",
      ok: unverified === 0,
      title: "Counterparties classified",
      detail: trace.addresses
        .map((a) => `${a.address.slice(0, 8)}… ${a.note ?? a.labels?.join("/") ?? a.classification}`)
        .join(" · "),
    },
  ]
}

/** Fallback summary/impacts when the LLM is disabled or unreachable — facts only, no judgement. */
export function templatedLlmOutput(trace: TraceReport, findings: readonly Finding[]): VerdictLlmOutput {
  const paths = trace.anchors.map((a) => a.path)
  const risk = maxRisk(findings.map((f) => f.severity))
  return {
    risk,
    summary:
      `${trace.decoded.functionName} writes ${paths.length} storage variable${paths.length === 1 ? "" : "s"} ` +
      `across ${trace.compressedContracts.length} contract${trace.compressedContracts.length === 1 ? "" : "s"}; LLM verdict unavailable, deterministic facts only.`,
    impacts: [
      paths.length ? `Written: ${paths.join(", ")}`.slice(0, 200) : "No attributable storage writes.",
      `Coverage ${trace.coverage.kind}; ${dedupeFrontiers(trace.unbounded).length} unbounded frontiers.`,
    ],
    reasoning:
      "The advisory model was unavailable, so this verdict is the deterministic floor from trace facts alone: " +
      findings.map((f) => `[${f.severity}] ${f.title}`).join("; ") +
      ". Review the findings before signing.",
  }
}

export function synthVerdict(args: {
  readonly trace: TraceReport
  readonly findings: readonly Finding[]
  readonly llm: VerdictLlmOutput | null
  readonly investigation?: string
  readonly durationMs: number
  readonly roundsUsed: number
}): GuardianVerdict {
  const ruleRisk = maxRisk(args.findings.map((f) => f.severity))
  const llm = args.llm ?? templatedLlmOutput(args.trace, args.findings)
  const risk = maxRisk([ruleRisk, llm.risk])
  return {
    risk,
    decision: decisionFor(risk),
    summary: llm.summary,
    impacts: llm.impacts,
    findings: args.findings,
    checks: buildChecks(args.trace),
    decoded: args.trace.decoded,
    coverage: args.trace.coverage,
    llm: args.llm
      ? { reasoning: args.llm.reasoning, ...(args.investigation ? { investigation: args.investigation } : {}) }
      : null,
    meta: {
      durationMs: args.durationMs,
      block: args.trace.block,
      roundsUsed: args.roundsUsed,
      tracer: "contract-storage-tracer",
    },
  }
}
