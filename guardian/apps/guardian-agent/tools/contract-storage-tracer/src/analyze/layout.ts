import { concat, keccak256, pad, toHex, type Hex } from "viem";
import type { SolcTypeInfo, StorageLayoutItem } from "./compile";

/**
 * Pure Solidity storage-layout math over solc's `storageLayout.types` map. Everything here is
 * deterministic slot arithmetic — no network, no AST. The one primitive it does NOT own is the
 * nested-mapping value slot, which lives in `./slot` (`mappingValueSlot`); this module supplies
 * the per-type key encoding that generalizes that primitive past address keys.
 */

/** Bytes occupied by a type, from the types map; 32 when unknown (single-slot assumption). */
export function typeBytes(typeId: string, types: Record<string, SolcTypeInfo>): number {
  const n = types[typeId]?.numberOfBytes;
  return n ? Number(n) : 32;
}

/** Number of whole 32-byte slots a byte-size spans (min 1). */
export function slotCount(bytes: number): number {
  return bytes <= 0 ? 1 : Math.ceil(bytes / 32);
}

/**
 * The inclusive slot range an inplace item occupies starting at its base slot. Mappings,
 * dynamic arrays and bytes/string report a single base slot here (their data lives elsewhere,
 * computed via `dynArrayDataSlot` / mapping key hashing).
 */
export function slotSpan(
  item: Pick<StorageLayoutItem, "slot" | "type">,
  types: Record<string, SolcTypeInfo>,
): { first: bigint; last: bigint } {
  const first = BigInt(item.slot);
  const info = types[item.type];
  if (info && info.encoding !== "inplace") return { first, last: first };
  const span = BigInt(slotCount(typeBytes(item.type, types)));
  return { first, last: first + span - 1n };
}

/**
 * Encodes a mapping key the way Solidity does before hashing: value types (address, uintN, intN,
 * bool, enum, contract) are left-padded to 32 bytes; fixed `bytesN` are right-padded; dynamic
 * `string`/`bytes` keys are the raw unpadded bytes.
 */
export function encodeMappingKey(raw: Hex, keyType: string): Hex {
  if (isDynamicBytesType(keyType)) return raw;
  if (isFixedBytesType(keyType)) return pad(raw, { size: 32, dir: "right" });
  return pad(raw, { size: 32, dir: "left" });
}

function isDynamicBytesType(typeId: string): boolean {
  return (
    typeId === "t_string_storage" ||
    typeId === "t_bytes_storage" ||
    typeId.startsWith("t_string") ||
    typeId === "t_bytes"
  );
}

/** `t_bytes1`..`t_bytes32` (fixed), but not dynamic `t_bytes`/`t_bytes_storage`. */
function isFixedBytesType(typeId: string): boolean {
  return /^t_bytes([1-9]|[12][0-9]|3[0-2])$/.test(typeId);
}

/** Child slot of `parent[key]`: keccak256(encodedKey ‖ pad32(parentSlot)). */
export function mappingChildSlot(parentSlot: bigint, encodedKey: Hex): Hex {
  return keccak256(concat([encodedKey, pad(toHex(parentSlot), { size: 32 })]));
}

/** First data slot of a dynamic array/bytes at `baseSlot`: keccak256(pad32(baseSlot)). */
export function dynArrayDataSlot(baseSlot: bigint): bigint {
  return BigInt(keccak256(pad(toHex(baseSlot), { size: 32 })));
}

/**
 * Struct members whose slot range (relative to the struct base) covers `slotDelta`. Usually one;
 * more than one only when small members are packed into the shared slot at `slotDelta`.
 */
export function structMemberAtSlotOffset(
  typeInfo: SolcTypeInfo,
  types: Record<string, SolcTypeInfo>,
  slotDelta: bigint,
): readonly StorageLayoutItem[] {
  const members = typeInfo.members ?? [];
  return members.filter((m) => {
    const first = BigInt(m.slot);
    const last = first + BigInt(slotCount(typeBytes(m.type, types))) - 1n;
    return slotDelta >= first && slotDelta <= last;
  });
}

/**
 * For an array whose data begins at `base` with element type `elemType`, the element index that
 * `slot` falls in and the slot offset within that element. Handles both large elements (≥1 slot
 * each) and small packed elements (many per slot). Returns undefined when `slot` precedes `base`.
 */
export function arrayIndexAt(
  base: bigint,
  slot: bigint,
  elemType: string,
  types: Record<string, SolcTypeInfo>,
): { index: bigint; elemSlotOffset: bigint } | undefined {
  if (slot < base) return undefined;
  const delta = slot - base;
  const bytes = typeBytes(elemType, types);
  if (bytes >= 32) {
    const perElem = BigInt(slotCount(bytes));
    return { index: delta / perElem, elemSlotOffset: delta % perElem };
  }
  const perSlot = BigInt(Math.floor(32 / bytes));
  // Small packed elements share a slot; without the byte offset we resolve to the first element
  // in the slot. The precise element is recovered from `offset` by the caller when available.
  return { index: delta * perSlot, elemSlotOffset: 0n };
}

/**
 * The items sharing a single storage slot, each with the byte range it occupies within that slot.
 * Drives packed-scalar attribution: with a pre/post pair the caller diffs these byte ranges to
 * find which packed member actually changed.
 */
export function packedMembersInSlot(
  items: readonly StorageLayoutItem[],
  types: Record<string, SolcTypeInfo>,
  slot: bigint,
): readonly {
  readonly item: StorageLayoutItem;
  readonly byteLo: number;
  readonly byteHi: number;
}[] {
  return items
    .filter((it) => BigInt(it.slot) === slot)
    .map((it) => ({ item: it, byteLo: it.offset, byteHi: it.offset + typeBytes(it.type, types) }));
}
