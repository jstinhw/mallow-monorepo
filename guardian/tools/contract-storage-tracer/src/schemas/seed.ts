import { z } from "zod";
import { chainIdSchema } from "../chains";
import { addressSchema, hexSchema } from "./common";

/**
 * The seed is a concrete call, named to match the EIP-1193 tx shape a wallet already holds.
 * `from` and the args decoded from `data` concretize the storage the call touches, which is
 * what lets the tracer bound each caller set (see docs/ARCHITECTURE.md §4). A tx hash, if
 * provided, is reduced to this shape upstream.
 */
export const seedSchema = z.object({
  chainId: chainIdSchema,
  from: addressSchema,
  to: addressSchema,
  data: hexSchema,
  /** Omit to pin the chain's current block at acquisition time. */
  block: z.number().int().nonnegative().optional(),
});

export type Seed = z.infer<typeof seedSchema>;

export function parseSeed(input: unknown): Seed {
  return seedSchema.parse(input);
}
