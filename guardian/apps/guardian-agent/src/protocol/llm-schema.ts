import type { RiskLevel } from "./types";

export type GuardianAction =
  "decode_calldata" | "get_contract_info" | "simulate_transaction" | "lookup_sourcify_signature";

export type GuardianActionPlan = {
  actions: GuardianAction[];
  reasoning: string;
};

export type GuardianLLMOutput = {
  summary: string;
  impacts: string[];
  risk: RiskLevel;
  reasoning: string;
};

export const ALLOWED_ACTIONS: GuardianAction[] = [
  "decode_calldata",
  "get_contract_info",
  "simulate_transaction",
  "lookup_sourcify_signature",
];
