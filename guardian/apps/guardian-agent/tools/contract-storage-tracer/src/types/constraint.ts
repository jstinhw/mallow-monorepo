import type { Address } from "viem"
import type { Provenance } from "./common"

/**
 * A precondition on the path to a storage touch (require / revert / modifier). A guard
 * "binds the caller" when it forces msg.sender to equal a key of the anchor or a
 * fixed/stored address — that is what turns an open function into a bounded one.
 */
export interface Guard {
  readonly source: "require" | "revert-if" | "modifier" | "assembly" | "inferred"
  readonly expression: string
  readonly bindsCaller: boolean
  readonly provenance: Provenance
}

/**
 * The authorized-caller set for a touch of the concrete anchor entry — the heart of the
 * recursion's boundedness (docs/ARCHITECTURE.md §4).
 *
 *  - singleton      exactly these addresses can touch it (e.g. {spender})   → bounded
 *  - fixed-onchain  msg.sender must equal a stored address (owner())         → bounded via read
 *  - role-set       msg.sender must be in a role/whitelist mapping           → bounded via oracle
 *  - unbounded      nothing binds msg.sender/key — ANYONE can touch it       → FLAGGED, not expanded
 */
export type Boundedness =
  | { readonly kind: "singleton"; readonly callers: readonly Address[]; readonly guards: readonly Guard[] }
  | { readonly kind: "fixed-onchain"; readonly caller: Address; readonly slot: string; readonly guards: readonly Guard[] }
  | {
      readonly kind: "role-set"
      readonly roleVar: string
      readonly enumeration: "events" | "trace" | "none"
      readonly guards: readonly Guard[]
    }
  | { readonly kind: "unbounded"; readonly reason: string; readonly guards: readonly Guard[] }
