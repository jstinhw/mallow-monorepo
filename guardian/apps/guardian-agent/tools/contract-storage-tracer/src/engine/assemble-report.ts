import type { Seed } from "../schemas/seed"
import type { AddressReport, AnchorReport, CompressedContract, Coverage, TraceReport } from "../types/report"
import type { Sarg } from "../types/sarg"
import { sliceByStorageCoupling } from "../analyze/slice"
import { addressBookLine, bookTag } from "./format"
import { toAddressReport, toCompressed, toDecodedSummary } from "./report-mappers"
import type { TokenClassification } from "./classify-touchers"
import type { RecursionResult } from "./recurse-callers"
import type { ResolvedSeed } from "./resolve-seed"
import type { Advisory } from "./advise"
import type { TraceSession } from "./session"

/** Deduplicates compressed contracts by address, keeping the first (widest) slice per address. */
function dedupeCompressed(items: readonly CompressedContract[]): readonly CompressedContract[] {
  const byAddress = new Map<string, CompressedContract>()
  for (const c of items) if (!byAddress.has(c.address.toLowerCase())) byAddress.set(c.address.toLowerCase(), c)
  return [...byAddress.values()]
}

/**
 * Merges the per-anchor token-side classifications with the shared recursion result into the
 * final `TraceReport`: one `AnchorReport` per written variable, a deduped token slice covering
 * all anchors, then caller slices in visit order. Coverage is `partial` iff any reason was
 * recorded or any slot went unattributed. Advisory (LLM) output only orders/annotates.
 */
export function assembleReport(
  session: TraceSession,
  seed: Seed,
  resolved: ResolvedSeed,
  tokenSides: readonly TokenClassification[],
  recursion: RecursionResult,
  advisory: Advisory = {},
): TraceReport {
  const { log } = session
  const { target, call, observation, anchors: instances } = resolved

  const anchorLabels = [...new Set(instances.map((a) => a.item.label))]
  const tokenSlice = anchorLabels.length > 0 ? [toCompressed(target.address, target.codehash, sliceByStorageCoupling(target.compiled, anchorLabels))] : []
  const compressed = dedupeCompressed([...tokenSlice, ...recursion.compressed])

  const addresses = new Map<string, AddressReport>([[target.address.toLowerCase(), toAddressReport(target)], ...recursion.addresses])
  const bookTags = new Map<string, string>([[target.address.toLowerCase(), bookTag(target)], ...recursion.bookTags])

  const anchorReports: AnchorReport[] = instances.map((ai, i) => {
    const bucket = recursion.perAnchor.get(i) ?? { chains: [], unbounded: [] }
    const triage = advisory.triage?.get(ai.item.label)
    return {
      variable: ai.item.label,
      baseSlot: ai.item.slot,
      ...(ai.observedSlot ? { slot: ai.observedSlot } : {}),
      path: ai.pathLabel,
      valueType: ai.anchor.valueType,
      access: ai.access,
      verification: ai.verification,
      chains: [...tokenSides[i]!.chains, ...bucket.chains],
      unbounded: [...tokenSides[i]!.unbounded, ...bucket.unbounded],
      ...(triage ? { triage } : {}),
    }
  })
  const orderedAnchors = advisory.triage ? [...anchorReports].sort((a, b) => (a.triage?.rank ?? 1e9) - (b.triage?.rank ?? 1e9)) : anchorReports

  log.step(`address book · ${addresses.size} addresses`)
  for (const a of addresses.values()) log.sub(`${addressBookLine(a)}${bookTags.get(a.address.toLowerCase()) ?? ""}`)

  const chains = [...tokenSides.flatMap((t) => t.chains), ...recursion.chains]
  const unbounded = [...tokenSides.flatMap((t) => t.unbounded), ...recursion.unbounded]
  const reasons = [...tokenSides.flatMap((t) => t.reasons), ...recursion.reasons]
  if (resolved.unattributed.length > 0) reasons.push(`${resolved.unattributed.length} observed slot(s) could not be attributed to a layout variable`)
  if (observation.reverted) reasons.push("the seed call reverts at the pinned block; anchors are static hypotheses")
  if (instances.length === 0) reasons.push("the seed call writes no attributable storage; nothing to trace (reads are context only)")
  const coverage: Coverage = reasons.length === 0 ? { kind: "complete" } : { kind: "partial", reasons }
  log.step(`done · ${instances.length} anchors · ${chains.length} chains · ${compressed.length} contracts · ${unbounded.length} unbounded · coverage ${coverage.kind}`)

  const block = Number(session.blockNumber)
  const graph: Sarg = { anchors: instances.map((a) => a.anchor), nodes: [...tokenSides.flatMap((t) => t.nodes), ...recursion.nodes], edges: recursion.edges }
  const anchorPhrase = instances.length === 1 ? instances[0]!.pathLabel : `${instances.length} anchors`
  const seedSummary =
    `${target.contractName}.${call.functionName}(...) from ${seed.from} @ block ${block} — ` +
    `anchor ${anchorPhrase}; slot verified vs chain: ${resolved.slotVerified}`

  return {
    seedSummary,
    block,
    decoded: toDecodedSummary(call),
    observation: { source: observation.source, reverted: observation.reverted, unattributed: observation.slots.length ? resolved.unattributed.map((o) => ({ slot: o.slot, ...(o.pre ? { pre: o.pre } : {}), ...(o.post ? { post: o.post } : {}) })) : [] },
    anchors: orderedAnchors,
    compressedContracts: compressed,
    chains,
    unbounded,
    addresses: [...addresses.values()],
    coverage,
    graph,
    ...(advisory.hypotheses && advisory.hypotheses.length ? { hypotheses: advisory.hypotheses } : {}),
  }
}
