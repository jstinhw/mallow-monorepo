import {
  ALLOWED_ACTIONS,
  guardianActionPlanSchema,
  guardianResponseSchema,
  type GuardianAction,
  type GuardianActionPlan,
  type GuardianLLMOutput,
} from "./schema";
import type { OpenAIToolSchema } from "../guardian/tools/types";
import { extractStringField } from "./partial-json";

export type LLMConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
};

export type GuardianSummaryDelta = {
  field: "summary" | "reasoning";
  text: string;
};

export type GuardianLLMConfig = LLMConfig & {
  onDelta?: (d: GuardianSummaryDelta) => void;
};

export async function callGuardianLLM(cfg: GuardianLLMConfig): Promise<GuardianLLMOutput | null> {
  if (cfg.onDelta) {
    return callJsonLLMStreaming(cfg, cfg.onDelta);
  }
  return callJsonLLM(cfg, guardianResponseSchema, isGuardianLLMOutput);
}

export async function callGuardianActionPlanLLM(
  cfg: LLMConfig,
): Promise<GuardianActionPlan | null> {
  return callJsonLLM(cfg, guardianActionPlanSchema, isGuardianActionPlan);
}

async function callJsonLLMStreaming(
  cfg: GuardianLLMConfig,
  onDelta: (d: GuardianSummaryDelta) => void,
): Promise<GuardianLLMOutput | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.1,
          stream: true,
          messages: [
            { role: "system", content: cfg.system },
            { role: "user", content: cfg.user },
          ],
          response_format: { type: "json_schema", json_schema: guardianResponseSchema },
        }),
      });
      if (!res.ok || !res.body) continue;

      let buf = "";
      let lastSummary = "";
      let lastReasoning = "";
      let lastEmittedSummary = "";
      let lastEmittedReasoning = "";
      let lastSummaryAt = 0;
      let lastReasoningAt = 0;
      const MIN_DELTA_INTERVAL_MS = 50;

      const maybeEmitSummary = () => {
        if (lastSummary === lastEmittedSummary) return;
        const now = Date.now();
        if (now - lastSummaryAt < MIN_DELTA_INTERVAL_MS) return;
        lastSummaryAt = now;
        lastEmittedSummary = lastSummary;
        onDelta({ field: "summary", text: lastSummary });
      };
      const maybeEmitReasoning = () => {
        if (lastReasoning === lastEmittedReasoning) return;
        const now = Date.now();
        if (now - lastReasoningAt < MIN_DELTA_INTERVAL_MS) return;
        lastReasoningAt = now;
        lastEmittedReasoning = lastReasoning;
        onDelta({ field: "reasoning", text: lastReasoning });
      };
      const forceEmitFinal = () => {
        if (lastSummary && lastSummary !== lastEmittedSummary) {
          lastEmittedSummary = lastSummary;
          onDelta({ field: "summary", text: lastSummary });
        }
        if (lastReasoning && lastReasoning !== lastEmittedReasoning) {
          lastEmittedReasoning = lastReasoning;
          onDelta({ field: "reasoning", text: lastReasoning });
        }
      };

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let sseBuf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuf += dec.decode(value, { stream: true });
        const events = sseBuf.split("\n\n");
        sseBuf = events.pop() ?? "";
        for (const ev of events) {
          for (const line of ev.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload) as {
                choices?: { delta?: { content?: string } }[];
              };
              const chunk = json.choices?.[0]?.delta?.content ?? "";
              if (!chunk) continue;
              buf += chunk;
              lastSummary = extractStringField(buf, "summary") ?? lastSummary;
              maybeEmitSummary();
              lastReasoning = extractStringField(buf, "reasoning") ?? lastReasoning;
              maybeEmitReasoning();
            } catch {
              // ignore malformed chunk; next ones may parse
            }
          }
        }
      }

      sseBuf += dec.decode();
      if (sseBuf.length > 0) {
        for (const line of sseBuf.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
            };
            const chunk = json.choices?.[0]?.delta?.content ?? "";
            if (chunk) {
              buf += chunk;
              lastSummary = extractStringField(buf, "summary") ?? lastSummary;
              maybeEmitSummary();
              lastReasoning = extractStringField(buf, "reasoning") ?? lastReasoning;
              maybeEmitReasoning();
            }
          } catch {
            // ignore malformed trailing chunk
          }
        }
      }

      forceEmitFinal();

      try {
        const parsed = JSON.parse(buf) as unknown;
        if (isGuardianLLMOutput(parsed)) return parsed;
      } catch {
        // fall through to retry
      }
    } catch {
      // retry
    }
  }
  return null;
}

async function callJsonLLM<T>(
  cfg: LLMConfig,
  responseSchema: typeof guardianResponseSchema | typeof guardianActionPlanSchema,
  validate: (value: unknown) => value is T,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.1,
          messages: [
            { role: "system", content: cfg.system },
            { role: "user", content: cfg.user },
          ],
          response_format: { type: "json_schema", json_schema: responseSchema },
        }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        choices?: { message?: { content?: string; reasoning_content?: string } }[];
      };
      const message = json.choices?.[0]?.message;
      const content = message?.content || message?.reasoning_content;
      if (!content) continue;
      const parsed = JSON.parse(content) as unknown;
      if (validate(parsed)) return parsed;
    } catch {
      // retry
    }
  }
  return null;
}

function isGuardianLLMOutput(value: unknown): value is GuardianLLMOutput {
  if (!value || typeof value !== "object") return false;
  const parsed = value as GuardianLLMOutput;
  return (
    typeof parsed.summary === "string" &&
    Array.isArray(parsed.impacts) &&
    parsed.impacts.every((impact) => typeof impact === "string") &&
    ["info", "low", "medium", "high", "critical"].includes(parsed.risk) &&
    typeof parsed.reasoning === "string"
  );
}

function isGuardianActionPlan(value: unknown): value is GuardianActionPlan {
  if (!value || typeof value !== "object") return false;
  const parsed = value as GuardianActionPlan;
  const allowed = new Set<GuardianAction>(ALLOWED_ACTIONS);
  return (
    Array.isArray(parsed.actions) &&
    parsed.actions.length > 0 &&
    parsed.actions.length <= ALLOWED_ACTIONS.length &&
    new Set(parsed.actions).size === parsed.actions.length &&
    parsed.actions.every((action): action is GuardianAction =>
      allowed.has(action as GuardianAction),
    ) &&
    typeof parsed.reasoning === "string"
  );
}

// ---------------------------------------------------------------------------
// Tool-using analyzer: single-round OpenAI tool-calling client.
// The analyzer agent owns the message-list and loop; this function performs
// one chat-completions round and returns the assistant message + finish reason.
// ---------------------------------------------------------------------------

export type ToolCallSpec = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type AssistantMessage = {
  role: "assistant";
  content: string | null;
  // Reasoning models (e.g. qwen3.x) emit their narrative here and may leave
  // `content` empty — especially when the response is cut off (finish_reason
  // "length"). Callers fall back to this when content is blank.
  reasoning_content?: string | null;
  tool_calls?: ToolCallSpec[];
};

export type AnalyzerMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

export type AnalyzerCallInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: AnalyzerMessage[];
  tools: OpenAIToolSchema[];
  toolChoice?: "auto" | "none" | "required";
  temperature?: number;
};

export type AnalyzerFinishReason = "stop" | "tool_calls" | "length" | "error";

export type AnalyzerCallOutput = {
  message: AssistantMessage;
  finishReason: AnalyzerFinishReason;
};

export async function callGuardianAnalyzerLLM(cfg: AnalyzerCallInput): Promise<AnalyzerCallOutput> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: cfg.temperature ?? 0.1,
    messages: cfg.messages,
  };
  if (cfg.tools.length > 0) {
    body.tools = cfg.tools;
    body.tool_choice = cfg.toolChoice ?? "auto";
  }
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        message: { role: "assistant", content: `LLM HTTP ${res.status}` },
        finishReason: "error",
      };
    }
    const json = (await res.json()) as {
      choices?: { message: AssistantMessage; finish_reason?: string }[];
    };
    const choice = json.choices?.[0];
    if (!choice || !choice.message) {
      return { message: { role: "assistant", content: "empty response" }, finishReason: "error" };
    }
    return {
      message: choice.message,
      finishReason: normalizeFinishReason(choice.finish_reason),
    };
  } catch (err) {
    return {
      message: { role: "assistant", content: err instanceof Error ? err.message : "fetch error" },
      finishReason: "error",
    };
  }
}

function normalizeFinishReason(r: string | undefined): AnalyzerFinishReason {
  if (r === "tool_calls" || r === "stop" || r === "length") return r;
  return "stop";
}
