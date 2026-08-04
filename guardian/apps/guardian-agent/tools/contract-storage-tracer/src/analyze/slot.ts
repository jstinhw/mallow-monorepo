import { concat, keccak256, pad, toHex, type Hex } from "viem"

/**
 * Computes the storage slot of a nested-mapping value. For `m[k1][k2]` the slot is
 * keccak256(k2 ‖ keccak256(k1 ‖ p)) with base slot p — applied left to right over `keys`.
 */
export function mappingValueSlot(baseSlot: bigint, keys: readonly Hex[]): Hex {
  let slot: Hex = pad(toHex(baseSlot), { size: 32 })
  for (const key of keys) {
    slot = keccak256(concat([pad(key, { size: 32 }), slot]))
  }
  return slot
}
