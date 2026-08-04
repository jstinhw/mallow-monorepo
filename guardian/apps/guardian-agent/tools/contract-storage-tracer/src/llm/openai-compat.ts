import type { z } from "zod";
import { fetchWithBackoff } from "../utils/net";
import {
  extractJsonObject,
  type ModelDelta,
  type ModelProvider,
  type ModelRequest,
} from "./provider";

export interface OpenAiCompatConfig {
  readonly name: string;
  /** e.g. http://localhost:1234/v1 for LM Studio, or any OpenAI-compatible base URL. */
  readonly baseUrl: string;
  /** Often unused for local servers. */
  readonly apiKey?: string;
  readonly model: string;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchFn?: typeof fetch;
}

interface ChatCompletionResponse {
  readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
}

interface ChatCompletionChunk {
  readonly choices?: readonly {
    readonly delta?: { readonly content?: string; readonly reasoning_content?: string };
    readonly finish_reason?: string | null;
  }[];
}

/** Reads an SSE chat-completion stream, reporting deltas and returning the accumulated content. */
async function readSseStream(
  res: Response,
  onDelta: (delta: ModelDelta) => void,
): Promise<{ content: string; finishReason: string; reasoningChars: number }> {
  if (!res.body) throw new Error("streaming response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason = "";
  let reasoningChars = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let chunk: ChatCompletionChunk;
      try {
        chunk = JSON.parse(data) as ChatCompletionChunk;
      } catch {
        continue; // keep-alive or malformed line
      }
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.delta?.reasoning_content) {
        reasoningChars += choice.delta.reasoning_content.length;
        onDelta({ channel: "reasoning", text: choice.delta.reasoning_content });
      }
      if (choice?.delta?.content) {
        content += choice.delta.content;
        onDelta({ channel: "content", text: choice.delta.content });
      }
    }
  }
  return { content, finishReason, reasoningChars };
}

/**
 * Talks the /chat/completions API, so it drives LM Studio, vLLM, Ollama's OpenAI shim, and OpenAI
 * itself unchanged. This is how the project stays model-agnostic and local-first.
 */
export function createOpenAiCompatProvider(cfg: OpenAiCompatConfig): ModelProvider {
  // Structured output is prompt-driven (the task prompts demand JSON-only, and `extractJsonObject`
  // tolerates fences/preamble) rather than relying on `response_format`, whose accepted values
  // differ across servers (LM Studio's newer API rejects `json_object`, wanting `json_schema`).
  // This keeps the provider portable across LM Studio, Ollama, vLLM, and OpenAI.
  async function call(req: ModelRequest): Promise<string> {
    let res: Response;
    try {
      res = await fetchWithBackoff(
        `${cfg.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: req.messages,
            temperature: req.temperature ?? 0,
            max_tokens: req.maxTokens ?? 2048,
            ...(req.onDelta ? { stream: true } : {}),
          }),
        },
        { ...(cfg.fetchFn ? { fetchFn: cfg.fetchFn } : {}) },
      );
    } catch (error) {
      throw new Error(
        `openai-compat '${cfg.name}' request to ${cfg.baseUrl} failed: ${String(error)}`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`openai-compat '${cfg.name}' returned ${res.status}: ${body.slice(0, 200)}`);
    }
    if (req.onDelta) {
      const stream = await readSseStream(res, req.onDelta);
      if (!stream.content && stream.finishReason === "length") {
        throw new Error(
          `model hit max_tokens (${req.maxTokens ?? 2048}) after ${stream.reasoningChars} chars of reasoning without producing content — raise maxTokens or shorten the prompt`,
        );
      }
      return stream.content;
    }
    const data = (await res.json()) as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content ?? "";
  }

  return {
    name: cfg.name,
    complete(req): Promise<string> {
      return call(req);
    },
    async respondJson<T>(req: ModelRequest, schema: z.ZodType<T>): Promise<T> {
      return schema.parse(JSON.parse(extractJsonObject(await call(req))));
    },
  };
}
