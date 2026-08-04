import type { AnchorTriage, RouteHypothesis } from "../types/report"
import { sliceByStorageCoupling } from "../analyze/slice"
import { triageAnchors } from "../llm/tasks/anchor-triage"
import { hypothesizeOpaqueRoutes, type OpaqueRouteInput } from "../llm/tasks/opaque-hypothesis"
import type { ResolvedSeed } from "./resolve-seed"
import type { RecursionResult } from "./recurse-callers"
import type { TraceSession } from "./session"

/**
 * The single deterministic↔advisory seam. Everything the LLM produces flows through here and can
 * only *add* `provenance:"hypothesis"` annotations (anchor triage ordering, opaque-route
 * hypotheses); it never changes a deterministic result. When no model is configured or any task
 * fails, `applyAdvisory` returns `{}` and the report is byte-identical to a model-free run.
 */
export interface Advisory {
  /** Triage annotations keyed by anchor variable name. */
  readonly triage?: ReadonlyMap<string, AnchorTriage>
  readonly hypotheses?: readonly RouteHypothesis[]
}

/** Collects opaque/role-set-trace reasons the recursion recorded, as inputs for the LLM. */
function opaqueRoutes(recursion: RecursionResult): readonly OpaqueRouteInput[] {
  const out: OpaqueRouteInput[] = []
  for (const reason of recursion.reasons) {
    const m = /^opaque: ([^.]+)\.([^ ]+) — (.+)$/.exec(reason)
    if (!m) continue
    const compressed = recursion.compressed.find((c) => c.sourceSlice.includes(`${m[2]}(`) || c.functions.includes(m[2]!))
    out.push({ contract: m[1]!, functionName: m[2]!, note: m[3]!, sourceSlice: compressed?.sourceSlice ?? "" })
  }
  return out
}

export async function applyAdvisory(
  session: TraceSession,
  resolved: ResolvedSeed,
  recursion: RecursionResult,
): Promise<Advisory> {
  const { llm, log } = session
  if (!llm) return {}
  if (!(await llm.reachable())) {
    log.note("advisory model configured but unreachable — skipping LLM annotations")
    return {}
  }

  const advisory: { triage?: Map<string, AnchorTriage>; hypotheses?: readonly RouteHypothesis[] } = {}

  // Anchor triage: only worth asking when the call writes more than one variable.
  const anchorVars = new Set(resolved.anchors.map((a) => a.item.label))
  if (anchorVars.size > 1) {
    const sourceSlice = sliceByStorageCoupling(resolved.target.compiled, [...anchorVars]).sourceSlice
    const result = await triageAnchors(llm.provider, {
      contractName: resolved.target.contractName,
      functionName: resolved.call.functionName,
      anchors: resolved.anchors.map((a) => ({ variable: a.item.label, type: a.anchor.valueType, path: a.pathLabel, access: a.access })),
      sourceSlice,
    })
    if (result) {
      const triage = new Map<string, AnchorTriage>()
      for (const r of result.rankings) {
        if (!anchorVars.has(r.variable) || triage.has(r.variable)) continue // drop hallucinated / duplicate variables
        triage.set(r.variable, { rank: r.rank, label: r.label, rationale: r.rationale, securityRelevance: r.securityRelevance, provenance: "hypothesis" })
      }
      if (triage.size > 0) advisory.triage = triage
    }
  }

  // Opaque-route hypotheses.
  const routes = opaqueRoutes(recursion)
  if (routes.length > 0) {
    const result = await hypothesizeOpaqueRoutes(llm.provider, routes)
    if (result && result.hypotheses.length > 0) {
      advisory.hypotheses = result.hypotheses.map((h) => ({
        route: h.route,
        controller: h.controller,
        confidence: h.confidence,
        explanation: h.explanation,
        ...(h.suggestedCheck ? { suggestedCheck: h.suggestedCheck } : {}),
        provenance: "hypothesis" as const,
      }))
    }
  }

  return advisory
}
