import { toHex, zeroAddress, type AbiParameter, type Hex } from "viem";
import type { KeyProvenance } from "../types/anchor";
import type { Seed } from "../schemas/seed";
import type { DecodedCall } from "../acquire/decode";

/**
 * A concrete value that could be a mapping key in the storage the seed touches, tagged with where
 * it came from. Attribution hashes these against observed slots to recover which key produced a
 * slot; the matched candidate's `origin` then becomes the anchor key's provenance — which is what
 * makes msg.sender-keyed boundedness fire for arbitrary calls, exactly as it does for allowance.
 */
export interface KeyCandidate {
  /** Unpadded canonical bytes of the value (address = 20 bytes, uint = minimal hex, bytesN as-is). */
  readonly raw: Hex;
  readonly label: string;
  readonly origin: KeyProvenance;
}

/** Canonical unpadded hex for a decoded argument value, or undefined if it can't be a key. */
function rawOf(value: unknown): Hex | undefined {
  if (typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value))
    return value.toLowerCase() as Hex;
  // Signed values are stored two's-complement; keep negatives valid 256-bit hex.
  if (typeof value === "bigint") return toHex(value < 0n ? BigInt.asUintN(256, value) : value);
  if (typeof value === "number" && Number.isInteger(value))
    return toHex(BigInt(value < 0 ? BigInt.asUintN(256, BigInt(value)) : value));
  if (typeof value === "boolean") return toHex(value ? 1n : 0n);
  return undefined;
}

/** Recursively flattens a decoded argument (including arrays/tuples) into key candidates. */
function flattenArg(
  value: unknown,
  type: AbiParameter | undefined,
  index: number,
  label: string,
): KeyCandidate[] {
  const out: KeyCandidate[] = [];
  const origin: KeyProvenance = { kind: "arg", index, ...(type?.name ? { name: type.name } : {}) };

  const raw = rawOf(value);
  if (raw !== undefined) out.push({ raw, label, origin });

  if (Array.isArray(value)) {
    const elemType = type && "components" in type ? undefined : type;
    value.forEach((el, i) => out.push(...flattenArg(el, elemType, index, `${label}[${i}]`)));
  }
  const components =
    type && "components" in type
      ? (type.components as readonly AbiParameter[] | undefined)
      : undefined;
  if (components && value && typeof value === "object" && !Array.isArray(value)) {
    for (const comp of components) {
      const field = (value as Record<string, unknown>)[comp.name ?? ""];
      if (field !== undefined)
        out.push(...flattenArg(field, comp, index, `${label}.${comp.name ?? "?"}`));
    }
  }
  return out;
}

/**
 * All values that might key the storage the seed touches: the caller (`from`, as both msg.sender
 * and tx.origin), the target (`to`), every decoded argument (recursively through arrays/tuples),
 * and the constants 0 / zero-address. Deduplicated by (raw, origin.kind).
 */
export function enumerateKeyCandidates(seed: Seed, decoded: DecodedCall): readonly KeyCandidate[] {
  const from = seed.from.toLowerCase() as Hex;
  const out: KeyCandidate[] = [
    { raw: from, label: "msg.sender", origin: { kind: "msg.sender" } },
    { raw: from, label: "tx.origin", origin: { kind: "tx.origin" } },
    {
      raw: seed.to.toLowerCase() as Hex,
      label: "seed.to",
      origin: { kind: "derived", note: "seed.to" },
    },
    { raw: "0x00", label: "0", origin: { kind: "constant", value: "0" } },
    { raw: zeroAddress, label: "address(0)", origin: { kind: "constant", value: zeroAddress } },
  ];

  decoded.args.forEach((arg, i) => {
    const type = decoded.inputs?.[i];
    const name = type?.name ?? `#${i}`;
    out.push(...flattenArg(arg, type, i, `arg:${name}`));
  });

  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.raw.toLowerCase()}|${c.origin.kind}|${c.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
