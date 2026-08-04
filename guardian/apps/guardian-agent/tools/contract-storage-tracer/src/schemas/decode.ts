import { z } from "zod"

export const signatureLookupSchema = z.object({
  ok: z.boolean(),
  result: z.object({
    function: z.record(z.string(), z.array(z.object({ name: z.string(), hasVerifiedContract: z.boolean().optional() })).nullable()).optional(),
  }),
})
