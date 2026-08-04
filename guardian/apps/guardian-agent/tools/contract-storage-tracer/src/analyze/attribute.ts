import { pad, toHex, type Hex } from "viem"
import type { SolcTypeInfo, StorageLayoutItem } from "./compile"
import type { SlotObservation } from "../acquire/observe"
import { PROXY_META_SLOTS } from "../acquire/proxy"
import type { KeyCandidate } from "./key-candidates"
import { arrayIndexAt, dynArrayDataSlot, encodeMappingKey, mappingChildSlot, slotCount, typeBytes } from "./layout"

/**
 * Maps raw storage slots the observer saw back to layout variables and concrete key/member paths.
 * Direct and packed slots resolve by arithmetic; mapping slots resolve by hashing the seed's key
 * candidates until one reproduces the observed slot (preimage search). Slots that can't be
 * explained (keys computed on-chain, unknown layout) are surfaced, not silently dropped.
 */

export type PathSegment =
  | { readonly kind: "mapping-key"; readonly encoded: Hex; readonly candidate: KeyCandidate }
  | { readonly kind: "array-index"; readonly index: string; readonly dynamic: boolean }
  | { readonly kind: "array-length" }
  | { readonly kind: "struct-member"; readonly member: string }
  | { readonly kind: "packed"; readonly byteLo: number; readonly byteHi: number; readonly changed?: boolean }

export interface AttributedSlot {
  readonly observed: SlotObservation
  readonly item: StorageLayoutItem
  readonly path: readonly PathSegment[]
  readonly valueType: string
}

export interface AttributionResult {
  readonly attributed: readonly AttributedSlot[]
  readonly unattributed: readonly SlotObservation[]
}

type Types = Record<string, SolcTypeInfo>

const big = (slot: string): bigint => BigInt(slot)

/** True if `pre` and `post` differ within byte range [lo, hi) of the big-endian 32-byte word. */
function changedInRange(pre: Hex | undefined, post: Hex | undefined, lo: number, hi: number): boolean | undefined {
  if (pre === undefined || post === undefined) return undefined
  const a = pad(pre, { size: 32 }).slice(2)
  const b = pad(post, { size: 32 }).slice(2)
  return a.slice(lo * 2, hi * 2) !== b.slice(lo * 2, hi * 2)
}

/** The packed segment for an item occupying `numberOfBytes` at `offset` within its slot. */
function packedSegment(item: StorageLayoutItem, types: Types, obs: SlotObservation): PathSegment {
  const size = typeBytes(item.type, types)
  const byteLo = 32 - item.offset - size
  const byteHi = 32 - item.offset
  const changed = changedInRange(obs.pre, obs.post, byteLo, byteHi)
  return { kind: "packed", byteLo, byteHi, ...(changed !== undefined ? { changed } : {}) }
}

/**
 * Describes an observed `slot` that falls inside an inplace value located at `base`, recursing
 * through struct members and array elements to build the access path. `topItem` is the layout
 * item the whole chain hangs off (kept for reporting the variable name).
 */
function describeInplace(
  typeId: string,
  base: bigint,
  slot: bigint,
  types: Types,
  topItem: StorageLayoutItem,
  obs: SlotObservation,
  prefix: readonly PathSegment[],
  siblings: readonly StorageLayoutItem[],
): readonly AttributedSlot[] {
  const info = types[typeId]

  if (info?.members) {
    const delta = slot - base
    const here = info.members.filter((m) => {
      const first = BigInt(m.slot)
      return delta >= first && delta <= first + BigInt(slotCount(typeBytes(m.type, types))) - 1n
    })
    if (here.length === 0) return []
    if (here.length === 1) {
      const m = here[0]!
      return describeInplace(m.type, base + BigInt(m.slot), slot, types, topItem, obs, [...prefix, { kind: "struct-member", member: m.label }], info.members)
    }
    // Packed struct members sharing this slot — one attribution each, `changed` per byte range.
    return here.map((m) => ({
      observed: obs,
      item: topItem,
      valueType: m.type,
      path: [...prefix, { kind: "struct-member" as const, member: m.label }, packedSegment(m, types, obs)],
    }))
  }

  if (info?.encoding === "inplace" && info.base) {
    const idx = arrayIndexAt(base, slot, info.base, types)
    if (!idx) return []
    const elemSlots = BigInt(slotCount(typeBytes(info.base, types)))
    const elemBase = base + idx.index * (elemSlots > 0n ? elemSlots : 1n)
    return describeInplace(info.base, elemBase, slot, types, topItem, obs, [...prefix, { kind: "array-index", index: idx.index.toString(), dynamic: false }], siblings)
  }

  // Value leaf. If other top-level items share this exact slot, it's packed — emit one each.
  const coPacked = siblings.filter((s) => BigInt(s.slot) === slot)
  if (coPacked.length > 1 && prefix.length === 0) {
    return coPacked.map((s) => ({ observed: obs, item: s, valueType: s.type, path: [packedSegment(s, types, obs)] }))
  }
  return [{ observed: obs, item: topItem, valueType: typeId, path: [...prefix] }]
}

/** Matches an observed slot against an inplace/dynamic-array/bytes value rooted at `base`. */
async function matchValueAt(
  typeId: string,
  base: bigint,
  types: Types,
  topItem: StorageLayoutItem,
  observedByBig: Map<bigint, SlotObservation>,
  matched: Set<bigint>,
  prefix: readonly PathSegment[],
  siblings: readonly StorageLayoutItem[],
  readLength: ((slot: Hex) => Promise<Hex | undefined>) | undefined,
  out: AttributedSlot[],
): Promise<void> {
  const info = types[typeId]

  if (info?.encoding === "dynamic_array" && info.base) {
    // Length slot.
    const lenObs = observedByBig.get(base)
    if (lenObs && !matched.has(base)) {
      matched.add(base)
      out.push({ observed: lenObs, item: topItem, valueType: typeId, path: [...prefix, { kind: "array-length" }] })
    }
    const dataSlot = dynArrayDataSlot(base)
    const length = await arrayLength(base, lenObs, readLength)
    if (length === undefined || length === 0n) return
    const step = BigInt(slotCount(typeBytes(info.base, types))) || 1n
    const dataEnd = dataSlot + length * step
    // Iterate the (few) observed slots that fall in the data region, not all `length` indices —
    // `length` is an on-chain value and can be enormous.
    for (const [s, obs] of observedByBig) {
      if (matched.has(s) || s < dataSlot || s >= dataEnd) continue
      const i = (s - dataSlot) / step
      const elemBase = dataSlot + i * step
      const attrs = describeInplace(info.base, elemBase, s, types, topItem, obs, [...prefix, { kind: "array-index", index: i.toString(), dynamic: true }], siblings)
      if (attrs.length > 0) {
        matched.add(s)
        out.push(...attrs)
      }
    }
    return
  }

  if (info?.encoding === "bytes") {
    // Short form (data + length in the base slot) or long form (data at keccak(base)).
    if (observedByBig.has(base) && !matched.has(base)) {
      matched.add(base)
      out.push({ observed: observedByBig.get(base)!, item: topItem, valueType: typeId, path: [...prefix] })
    }
    return
  }

  // Inplace value / struct / fixed array spanning [base, base + slotCount - 1].
  const span = BigInt(slotCount(typeBytes(typeId, types)))
  for (let s = base; s <= base + span - 1n; s++) {
    if (observedByBig.has(s) && !matched.has(s)) {
      const attrs = describeInplace(typeId, base, s, types, topItem, observedByBig.get(s)!, prefix, siblings)
      if (attrs.length > 0) {
        matched.add(s)
        out.push(...attrs)
      }
    }
  }
}

/** Parses a storage word to a bigint, tolerating the empty-slot value "0x" (BigInt("0x") throws). */
const wordToBig = (h: Hex): bigint => (h === "0x" ? 0n : BigInt(h))

/** Best-effort dynamic-array length: from the length slot's observed value, else `readLength`. */
async function arrayLength(base: bigint, lenObs: SlotObservation | undefined, readLength: ((slot: Hex) => Promise<Hex | undefined>) | undefined): Promise<bigint | undefined> {
  const observed = lenObs?.post ?? lenObs?.pre
  if (observed !== undefined) return wordToBig(observed)
  if (!readLength) return undefined
  const raw = await readLength(pad(toHex(base), { size: 32 }))
  return raw !== undefined ? wordToBig(raw) : undefined
}

/** BFS preimage search over a mapping type, hashing key candidates to reach observed slots. */
async function matchMapping(
  item: StorageLayoutItem,
  types: Types,
  candidates: readonly KeyCandidate[],
  observedByBig: Map<bigint, SlotObservation>,
  matched: Set<bigint>,
  readLength: ((slot: Hex) => Promise<Hex | undefined>) | undefined,
  siblings: readonly StorageLayoutItem[],
  out: AttributedSlot[],
): Promise<void> {
  interface Frame {
    readonly parentSlot: bigint
    readonly typeId: string
    readonly path: readonly PathSegment[]
  }
  const worklist: Frame[] = [{ parentSlot: big(item.slot), typeId: item.type, path: [] }]

  while (worklist.length > 0) {
    const frame = worklist.pop()!
    const info = types[frame.typeId]
    if (info?.encoding !== "mapping" || !info.key || !info.value) continue

    for (const candidate of candidates) {
      const encoded = encodeMappingKey(candidate.raw, info.key)
      const child = big(mappingChildSlot(frame.parentSlot, encoded))
      const path: readonly PathSegment[] = [...frame.path, { kind: "mapping-key", encoded, candidate }]
      const valueInfo = types[info.value]
      if (valueInfo?.encoding === "mapping") {
        worklist.push({ parentSlot: child, typeId: info.value, path })
      } else {
        await matchValueAt(info.value, child, types, item, observedByBig, matched, path, siblings, readLength, out)
      }
    }
  }
}

/**
 * Attributes observed slots for a single contract to its storage layout. `readLength` (optional)
 * lets dynamic-array attribution read a length slot at the pinned block; without it, array data
 * slots resolve only when the length was itself observed.
 */
export async function attributeSlots(
  storage: readonly StorageLayoutItem[],
  storageTypes: Types,
  observed: readonly SlotObservation[],
  candidates: readonly KeyCandidate[],
  readLength?: (slot: Hex) => Promise<Hex | undefined>,
): Promise<AttributionResult> {
  const observedByBig = new Map<bigint, SlotObservation>()
  for (const o of observed) {
    if (PROXY_META_SLOTS.has(o.slot.toLowerCase())) continue
    observedByBig.set(big(o.slot), o)
  }

  const matched = new Set<bigint>()
  const out: AttributedSlot[] = []

  for (const item of storage) {
    const info = storageTypes[item.type]
    if (info?.encoding === "mapping") {
      await matchMapping(item, storageTypes, candidates, observedByBig, matched, readLength, storage, out)
    } else {
      await matchValueAt(item.type, big(item.slot), storageTypes, item, observedByBig, matched, [], storage, readLength, out)
    }
  }

  const unattributed = observed.filter((o) => {
    if (PROXY_META_SLOTS.has(o.slot.toLowerCase())) return false
    return !matched.has(big(o.slot))
  })
  return { attributed: out, unattributed }
}
