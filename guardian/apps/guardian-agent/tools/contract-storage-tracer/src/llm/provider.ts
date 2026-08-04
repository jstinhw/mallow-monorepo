import type { z } from "zod";

export interface ModelMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** One streamed token chunk. Reasoning models emit "reasoning" before the final "content". */
export interface ModelDelta {
  readonly channel: "reasoning" | "content";
  readonly text: string;
}

export interface ModelRequest {
  readonly messages: readonly ModelMessage[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** When set, the provider streams the response and reports each delta as it arrives. */
  readonly onDelta?: (delta: ModelDelta) => void;
}

/**
 * Provider-agnostic model client. Every LLM use in the project goes through this one interface,
 * so swapping a local LM Studio model for Claude (or anything else) is config, not code. It is
 * strictly advisory: nothing it returns enters the report without a deterministic check or a
 * `provenance:"hypothesis"` tag. Implementation: `openai-compat` (LM Studio / vLLM / Ollama /
 * OpenAI); an Anthropic provider is a drop-in behind the same interface.
 */
export interface ModelProvider {
  readonly name: string;
  complete(req: ModelRequest): Promise<string>;
  /** Structured output validated against a zod schema (all advisory tasks use this). */
  respondJson<T>(req: ModelRequest, schema: z.ZodType<T>): Promise<T>;
}

/** Pulls the first {...} object out of a model's text so JSON survives minor preamble. */
export function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`no JSON object in model output: ${text.slice(0, 160)}`);
  }
  return text.slice(start, end + 1);
}
