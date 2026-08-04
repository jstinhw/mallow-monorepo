import { z } from "zod"

export const anchorTriageSchema = z.object({
  rankings: z
    .array(
      z.object({
        variable: z.string(),
        rank: z.number().int().positive(),
        label: z.string().max(80),
        rationale: z.string().max(300),
        securityRelevance: z.enum(["critical", "high", "medium", "low"]),
      }),
    )
    .min(1),
})

export type AnchorTriageResult = z.infer<typeof anchorTriageSchema>

export const opaqueHypothesisSchema = z.object({
  hypotheses: z.array(
    z.object({
      route: z.string(),
      controller: z.string().max(120),
      confidence: z.enum(["high", "medium", "low"]),
      explanation: z.string().max(400),
      suggestedCheck: z.string().max(200).optional(),
    }),
  ),
})

export type OpaqueHypothesisResult = z.infer<typeof opaqueHypothesisSchema>
