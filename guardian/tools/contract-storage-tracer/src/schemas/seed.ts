import { z } from "zod";
import { chainIdSchema } from "../chains";
import { addressSchema, hexSchema } from "./common";

/**
 * The seed is a concrete call, named to match the EIP-1193 tx shape a wallet already holds.
 * `from` and the args decoded from `data` concretize the storage the call touches, which is
 * what lets the tracer bound each caller set (see docs/ARCHITECTURE.md §4). A tx hash, if
 * provided, is reduced to this shape upstream.
 */
/** Wei as a wallet emits it: hex (`0x…`), decimal string, or number. */
const weiSchema = z.union([z.string(), z.number()]).refine((v) => {
  try {
    return BigInt(v) >= 0n;
  } catch {
    return false;
  }
}, "must be a non-negative amount of wei (hex or decimal)");

export const seedSchema = z.object({
  chainId: chainIdSchema,
  from: addressSchema,
  to: addressSchema,
  data: hexSchema,
  /** Omit to pin the chain's current block at acquisition time. */
  block: z.number().int().nonnegative().optional(),
  /**
   * Wei attached to the call. Carried into every simulation (`eth_call`, `debug_traceCall`,
   * `eth_createAccessList`) so a payable call is traced down the branch it actually takes —
   * dropping it would trace the `msg.value == 0` path and describe a different call.
   */
  value: weiSchema.optional(),
});

export type Seed = z.infer<typeof seedSchema>;

/** A seed's `value` as wei. Absent means none, which is what an omitted `value` means on-chain. */
export const weiOf = (value: Seed["value"]): bigint => (value === undefined ? 0n : BigInt(value));

export function parseSeed(input: unknown): Seed {
  return seedSchema.parse(input);
}
