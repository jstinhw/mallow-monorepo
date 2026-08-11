import type { z } from "zod";
import { redact } from "../redact";
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

/** Every OpenAI-compatible server can report a failure in-band, on a 200. */
interface InBandError {
  readonly error?: { readonly message?: string } | string;
}

interface ChatCompletionResponse extends InBandError {
  readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
}

interface ChatCompletionChunk extends InBandError {
  readonly choices?: readonly {
    readonly delta?: { readonly content?: string; readonly reasoning_content?: string };
    readonly finish_reason?: string | null;
  }[];
}

/**
 * Once the headers are out the server can no longer use a status code, so a failure arrives as a
 * payload like LM Studio's `{"error":{"message":"Context size has been exceeded."}}` on a 200.
 * Skipping that frame leaves the call returning "", which downstream misreports as "no JSON object
 * in model output" and silently drops the verdict to deterministic-only — so read it and throw.
 */
function inBandError(payload: InBandError): string | undefined {
  const reported = payload.error;
  if (!reported) return undefined;
  return typeof reported === "string"
    ? reported
    : (reported.message ?? "model server reported an error");
}

/**
 * One model server serves one context budget, so a second concurrent request is rejected rather
 * than queued (LM Studio answers it with the in-band error above, and both callers then lose their
 * LLM verdict). Serializing per server keeps every other phase parallel — only the model turn waits.
 * ponytail: FIFO counting semaphore keyed by base URL, ceiling `LLM_MAX_CONCURRENCY` (default 1,
 * right for LM Studio/Ollama; raise it for a server with real parallel slots like vLLM/OpenAI).
 * If per-model limits ever diverge on one server, key it by `${baseUrl}|${model}` instead.
 */
type Gate = <T>(onQueued: (() => void) | undefined, run: () => Promise<T>) => Promise<T>;

function createGate(limit: number): Gate {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(onQueued: (() => void) | undefined, run: () => Promise<T>): Promise<T> => {
    if (active < limit) active += 1;
    else {
      onQueued?.();
      // Resolved by whoever releases: it hands its slot straight over instead of decrementing,
      // so a newcomer can never slip into the gap and oversubscribe the server.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await run();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

const gates = new Map<string, Gate>();

function gateFor(baseUrl: string): Gate {
  const existing = gates.get(baseUrl);
  if (existing) return existing;
  const limit = Number(process.env.LLM_MAX_CONCURRENCY);
  const created = createGate(Number.isInteger(limit) && limit > 0 ? limit : 1);
  gates.set(baseUrl, created);
  return created;
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
  try {
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
        const failure = inBandError(chunk);
        if (failure) throw new Error(failure);
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
  } finally {
    // Bailing out mid-stream would otherwise leave the body unread and the socket pinned.
    await reader.cancel().catch(() => undefined);
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
  async function send(req: ModelRequest): Promise<string> {
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
          // Prompts are built from trace output and relayed error text, so the whole
          // serialized body is redacted before it leaves for a third-party model.
          body: redact(
            JSON.stringify({
              model: cfg.model,
              messages: req.messages,
              temperature: req.temperature ?? 0,
              max_tokens: req.maxTokens ?? 2048,
              ...(req.onDelta ? { stream: true } : {}),
            }),
          ),
          ...(req.signal ? { signal: req.signal } : {}),
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
      // Any empty completion is a failure the caller has to see. Returning "" launders a whole
      // class of upstream refusals into `extractJsonObject`'s "no JSON object in model output:"
      // with nothing after the colon, which names the wrong layer and hides the real cause.
      if (!stream.content) {
        const budget = req.maxTokens ?? 2048;
        throw new Error(
          stream.finishReason === "length"
            ? `model hit max_tokens (${budget}) after ${stream.reasoningChars} chars of reasoning without producing content — raise maxTokens or shorten the prompt`
            : `model returned no content (finish_reason ${stream.finishReason || "none"}, ${stream.reasoningChars} chars of reasoning, max_tokens ${budget}) — the server likely refused the request; check that max_tokens fits the served model's context size`,
        );
      }
      return stream.content;
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const failure = inBandError(data);
    if (failure) throw new Error(failure);
    return data.choices?.[0]?.message?.content ?? "";
  }

  /** Every call to this server queues through one gate, whichever provider instance issued it. */
  const call = (req: ModelRequest): Promise<string> =>
    gateFor(cfg.baseUrl)(req.onQueued, () => send(req));

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
