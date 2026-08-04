import { z } from "zod";

/** 0x-prefixed hex of any length (calldata, slots, hashes). */
export const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, "must be 0x-prefixed hex");

/** 20-byte address. */
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte 0x address");
