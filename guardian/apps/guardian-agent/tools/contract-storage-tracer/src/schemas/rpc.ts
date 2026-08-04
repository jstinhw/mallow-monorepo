import { z } from "zod"
import { hexSchema } from "./common"

/**
 * Zod schemas for the non-standard JSON-RPC responses the observer consumes. Node
 * implementations vary in the extra fields they return, so every object is permissive
 * (`.passthrough()`) about unknown keys while pinning the shapes we actually read.
 */

export const accountStateSchema = z
  .object({
    storage: z.record(hexSchema, hexSchema).optional(),
  })
  .passthrough()

/** `debug_traceCall` + prestateTracer, default (non-diff) mode: address -> touched state. */
export const prestateFlatSchema = z.record(z.string(), accountStateSchema)

/** `debug_traceCall` + prestateTracer, `diffMode: true`: pre/post state of changed accounts. */
export const prestateDiffSchema = z.object({
  pre: prestateFlatSchema.optional(),
  post: prestateFlatSchema.optional(),
})

/** `eth_createAccessList`: the touched (read-or-write) storage keys per address. */
export const accessListSchema = z
  .object({
    accessList: z.array(
      z.object({
        address: z.string(),
        storageKeys: z.array(hexSchema),
      }),
    ),
  })
  .passthrough()

export type PrestateDiff = z.infer<typeof prestateDiffSchema>
export type PrestateFlat = z.infer<typeof prestateFlatSchema>
export type AccessListResult = z.infer<typeof accessListSchema>
