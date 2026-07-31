import type { GuardianAction } from "./llm-schema";

export type ToolStartEvent = {
  stage: "analyze";
  phase: "tool_start";
  callId: string;
  round: number;
  label: string;
};

export type ToolCompleteEvent = {
  stage: "analyze";
  phase: "tool_complete";
  callId: string;
  round: number;
  label: string;
  ok: boolean;
  durationMs: number;
  summary: string;
};

export type PlanReadyEvent = {
  stage: "plan_ready";
  actions: GuardianAction[];
  reasoning: string;
};

export type AnalyzeThinkingEvent = {
  stage: "analyze_thinking";
  round: number;
  intent: string;
};

export type LLMDeltaEvent = {
  stage: "llm_delta";
  field: "summary" | "reasoning";
  text: string;
};

export type ProgressEvent =
  | { stage: "plan" }
  | PlanReadyEvent
  | { stage: "analyze" }
  | AnalyzeThinkingEvent
  | ToolStartEvent
  | ToolCompleteEvent
  | { stage: "llm" }
  | LLMDeltaEvent
  | { stage: "verdict" };
