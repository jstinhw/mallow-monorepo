import type { Address, Hash } from "viem"
import type { Access, Provenance } from "./common"
import type { Anchor } from "./anchor"
import type { Boundedness } from "./constraint"

export interface StorageAccess {
  readonly slot: string
  readonly access: Access
}

export interface NodeId {
  readonly chainId: number
  readonly address: Address
  readonly selector: string
}

export interface SargNode {
  readonly id: NodeId
  readonly codehash: Hash
  readonly functionName: string
  /** Direct anchor touches (transitive reach is expressed via edges). */
  readonly touches: readonly StorageAccess[]
  /** Who may reach the touch of the concrete anchor entry. */
  readonly boundedness: Boundedness
  /** Source available (true) vs bytecode-only best effort (false). */
  readonly verified: boolean
}

export type EdgeKind = "internal-call" | "external-call" | "caller-of" | "shares-storage"

export interface SargEdge {
  readonly kind: EdgeKind
  readonly from: NodeId
  readonly to: NodeId
  readonly callsite?: string
  readonly targetResolution?: "hardcoded" | "immutable" | "state-read" | "polymorphic"
  readonly provenance: Provenance
}

export interface Sarg {
  /** Every anchor traced from this seed (one per storage variable the call writes). */
  readonly anchors: readonly Anchor[]
  readonly nodes: readonly SargNode[]
  readonly edges: readonly SargEdge[]
}
