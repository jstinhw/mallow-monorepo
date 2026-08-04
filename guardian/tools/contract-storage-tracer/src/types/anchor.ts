import type { Hash } from "viem";

/**
 * How a mapping key at an access site is derived. This is the raw material for
 * "key-as-caller" binding (B1): a key whose provenance is `msg.sender` pins the caller
 * once the anchor entry is concrete.
 */
export type KeyProvenance =
  | { readonly kind: "msg.sender" }
  | { readonly kind: "tx.origin" }
  | { readonly kind: "arg"; readonly index: number; readonly name?: string }
  | { readonly kind: "constant"; readonly value: string }
  | { readonly kind: "storage"; readonly slot: string; readonly note?: string }
  | { readonly kind: "derived"; readonly note: string }
  | { readonly kind: "unknown" };

export interface MappingKey {
  readonly provenance: KeyProvenance;
  /** Concrete value when known from the seed calldata (e.g. the spender). */
  readonly concrete?: string;
}

/**
 * A storage location being traced. A mapping is identified by its base slot plus a
 * (possibly concrete) key path — `_allowances[owner][spender]` → keyPath [owner, spender].
 * Scalars have an empty keyPath; struct members / array elements carry an `elementPath`
 * (e.g. `["x"]` for `s.x`, `["[3]"]` for `arr[3]`).
 */
export interface Anchor {
  readonly codehash: Hash;
  readonly baseSlot: string;
  readonly variable: string;
  readonly keyPath: readonly MappingKey[];
  readonly valueType: string;
  readonly elementPath?: readonly string[];
}
