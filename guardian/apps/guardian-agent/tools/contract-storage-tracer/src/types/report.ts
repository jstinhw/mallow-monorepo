import type { Address } from "viem"
import type { Access, Provenance } from "./common"
import type { Boundedness } from "./constraint"
import type { Sarg } from "./sarg"

/** Deliverable #1: a contract sliced to only what touches the anchor. */
export interface CompressedContract {
  readonly address: Address
  readonly codehash: string
  readonly storage: readonly string[]
  readonly functions: readonly string[]
  readonly sourceSlice: string
  readonly verified: boolean
}

/** Deliverable #2: one route to a storage touch. */
export interface CallChain {
  readonly path: readonly string[]
  readonly op: Access
  readonly boundedness: Boundedness
  readonly provenance: Provenance
}

/** Where an unbounded frontier was found — the explicit "point it out" output. */
export interface UnboundedFrontier {
  readonly node: string
  readonly reason: string
}

export type Coverage =
  | { readonly kind: "complete" }
  | { readonly kind: "partial"; readonly reasons: readonly string[] }

/** Per-address classification + collected info (code / sent-txs / tags). */
export interface AddressReport {
  readonly address: Address
  readonly classification: "contract" | "eoa" | "undetermined" | "unverified"
  readonly nonce?: number
  readonly sentTxs?: boolean
  readonly ens?: string
  readonly labels?: readonly string[]
  /** EIP-7702 delegate, when the EOA has delegated code. */
  readonly delegation?: string
  readonly note?: string
}

/** One decoded calldata argument. Values are stringified (bigints as decimal) for JSON safety. */
export interface DecodedArg {
  readonly name?: string
  readonly type?: string
  readonly value: string
}

/** How the decoded seed call was understood. */
export interface DecodedSummary {
  readonly selector: string
  readonly functionName: string
  readonly source: "contract-abi" | "signature-db" | "unknown"
  /** Decoded argument values — lets a consumer judge amounts and counterparties, not just the selector. */
  readonly args: readonly DecodedArg[]
}

/** What the storage observation saw, and which slots it couldn't explain. */
export interface ObservationSummary {
  readonly source: "prestate-diff" | "access-list" | "static"
  readonly reverted: boolean
  readonly unattributed: readonly { readonly slot: string; readonly pre?: string; readonly post?: string }[]
}

/** Optional LLM triage annotation on an anchor (advisory; never affects the deterministic trace). */
export interface AnchorTriage {
  readonly rank: number
  readonly label: string
  readonly rationale: string
  readonly securityRelevance: "critical" | "high" | "medium" | "low"
  readonly provenance: "hypothesis"
}

/** One traced storage variable the seed writes, with its routes and boundedness. */
export interface AnchorReport {
  readonly variable: string
  readonly baseSlot: string
  readonly slot?: string
  /** Rendered access path, e.g. `allowed[0x28c6…][0xd8da…]`, `config`, `p.x`, `holders[3]`. */
  readonly path: string
  readonly valueType: string
  readonly access: "write" | "touch" | "static-write"
  readonly verification: "observed-write" | "prestate-match" | "static-hypothesis"
  readonly chains: readonly CallChain[]
  readonly unbounded: readonly UnboundedFrontier[]
  readonly triage?: AnchorTriage
}

/** An LLM hypothesis about who controls an opaque route (advisory; tagged, never verified). */
export interface RouteHypothesis {
  readonly route: string
  readonly controller: string
  readonly confidence: "high" | "medium" | "low"
  readonly explanation: string
  readonly suggestedCheck?: string
  readonly provenance: "hypothesis"
}

export interface TraceReport {
  readonly seedSummary: string
  readonly block: number
  readonly decoded: DecodedSummary
  readonly observation: ObservationSummary
  readonly anchors: readonly AnchorReport[]
  readonly compressedContracts: readonly CompressedContract[]
  readonly chains: readonly CallChain[]
  readonly unbounded: readonly UnboundedFrontier[]
  readonly addresses: readonly AddressReport[]
  readonly coverage: Coverage
  readonly graph: Sarg
  readonly hypotheses?: readonly RouteHypothesis[]
}
