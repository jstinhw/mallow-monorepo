import { ALLOWED_ACTIONS } from "../protocol";

export type { GuardianAction, GuardianActionPlan, GuardianLLMOutput } from "../protocol";
export { ALLOWED_ACTIONS };

export const guardianResponseSchema = {
  name: "guardian_verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "impacts", "risk", "reasoning"],
    properties: {
      summary: { type: "string", minLength: 20, maxLength: 320 },
      impacts: {
        type: "array",
        items: { type: "string", minLength: 6, maxLength: 160 },
        minItems: 1,
        maxItems: 6,
      },
      risk: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
      reasoning: { type: "string", minLength: 60, maxLength: 800 },
    },
  },
} as const;

export const guardianActionPlanSchema = {
  name: "guardian_action_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["actions", "reasoning"],
    properties: {
      actions: {
        type: "array",
        items: { type: "string", enum: ALLOWED_ACTIONS },
        minItems: 1,
        maxItems: 4,
        uniqueItems: true,
      },
      reasoning: { type: "string", maxLength: 400 },
    },
  },
} as const;
