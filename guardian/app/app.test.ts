import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer, type AnalyzeFn } from "./app";
import type { AgentReport } from "../agent/agent";
import { createOpenAiCompatProvider } from "../tools/contract-storage-tracer/src/llm/openai-compat";
import { fetchWithBackoff } from "../tools/contract-storage-tracer/src/utils/net";

afterEach(() => {
  vi.unstubAllEnvs();
});

const VALID_BODY = {
  chainId: 1,
  from: "0x28C6c06298d514Db089934071355E5743bf21d60",
  to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  value: "0x0",
  data: "0x095ea7b3",
};

const fakeVerdict = {
  risk: "low",
  decision: "sign",
  summary: "ok",
  meta: { durationMs: 1, block: 1, roundsUsed: 0, tracer: "contract-storage-tracer" },
} as unknown as AgentReport["verdict"];

const fakeAnalyze: AnalyzeFn = async (_input, hooks) => {
  hooks.onProgress?.("tracing storage writes (deterministic)…");
  hooks.onDelta?.({ channel: "content", text: "hi" });
  return { verdict: fakeVerdict } as AgentReport;
};

const events = (payload: string): string[] =>
  payload
    .split("\n")
    .filter((l) => l.startsWith("event: "))
    .map((l) => l.slice(7));

describe("POST /check", () => {
  it("streams progress, deltas and the verdict as SSE", async () => {
    const app = buildServer(fakeAnalyze);
    const res = await app.inject({ method: "POST", url: "/check", payload: VALID_BODY });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(events(res.payload)).toEqual(["progress", "delta", "verdict"]);
    expect(res.payload).toContain('data: {"risk":"low"');
  });

  it("ends the stream with an error event when the agent throws", async () => {
    const app = buildServer(async () => {
      throw new Error("rpc down");
    });
    const res = await app.inject({ method: "POST", url: "/check", payload: VALID_BODY });

    expect(events(res.payload)).toEqual(["error"]);
    expect(res.payload).toContain("rpc down");
  });

  it("keeps the CORS headers on the streamed response", async () => {
    const app = buildServer(fakeAnalyze);
    const res = await app.inject({
      method: "POST",
      url: "/check",
      payload: VALID_BODY,
      headers: { origin: "https://mallow.onrender.com" },
    });

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("rejects a malformed body before starting the stream", async () => {
    const app = buildServer(fakeAnalyze);
    const res = await app.inject({
      method: "POST",
      url: "/check",
      payload: { ...VALID_BODY, to: "not-an-address" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid request");
  });

  it("rejects an unsupported chain", async () => {
    const app = buildServer(fakeAnalyze);
    const res = await app.inject({
      method: "POST",
      url: "/check",
      payload: { ...VALID_BODY, chainId: 999999 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects a body still using the old `calldata` spelling", async () => {
    const { data, ...rest } = VALID_BODY;
    const res = await buildServer(fakeAnalyze).inject({
      method: "POST",
      url: "/check",
      payload: { ...rest, calldata: data },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toContain("data: Required");
  });

  it("never streams the RPC API key to the browser", async () => {
    // The RPC URL carries ALCHEMY_API_KEY in its path, and viem puts the whole URL into
    // `HttpRequestError.message` — so a failed RPC call reaches both an `error` frame and
    // the log with the key in it unless the boundary redacts.
    const key = "alchemy-key-that-must-never-ship";
    const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${key}`;
    vi.stubEnv("ALCHEMY_API_KEY", key);

    const leaky: AnalyzeFn = async (_input, hooks) => {
      hooks.onProgress?.(`[trace]  1. connect chain 1 via ${rpcUrl}`);
      hooks.onDelta?.({ channel: "reasoning", text: `the node at ${rpcUrl} refused` });
      throw new Error(`HTTP request failed.\n\nURL: ${rpcUrl}\nDetails: Must be authenticated!`);
    };
    const res = await buildServer(leaky).inject({
      method: "POST",
      url: "/check",
      payload: VALID_BODY,
    });

    expect(res.payload).not.toContain(key);
    expect(events(res.payload)).toEqual(["progress", "delta", "error"]);
    // Redacted, not dropped: the user still sees which host failed and why.
    expect(res.payload).toContain("[redacted]");
    expect(res.payload).toContain("eth-mainnet.g.alchemy.com");
    expect(res.payload).toContain("Must be authenticated!");
  });

  it("accepts a value-bearing call and passes the value to the agent", async () => {
    const seen: unknown[] = [];
    const res = await buildServer(async (input, hooks) => {
      seen.push(input);
      return fakeAnalyze(input, hooks);
    }).inject({
      method: "POST",
      url: "/check",
      // A plain ETH transfer: value, no calldata — the most common tx a wallet signs.
      payload: { ...VALID_BODY, value: "10000000000000000", data: "0x" },
    });

    expect(res.statusCode).toBe(200);
    expect(events(res.payload)).toEqual(["progress", "delta", "verdict"]);
    expect(seen[0]).toMatchObject({ value: "10000000000000000", data: "0x" });
  });

  it("rejects a value that is not a wei amount", async () => {
    const res = await buildServer(fakeAnalyze).inject({
      method: "POST",
      url: "/check",
      payload: { ...VALID_BODY, value: "1.5" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toContain(
      "value: must be a non-negative amount of wei (hex or decimal)",
    );
  });
});

const sseOk = 'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\ndata: [DONE]\n\n';
const sseRefused = 'data: {"error":{"message":"Context size has been exceeded."}}\n\n';

/** LM Studio's real behaviour: one context budget, so an overlapping request is refused on a 200. */
function singleSlotServer(): { readonly fetchFn: typeof fetch; readonly peak: () => number } {
  let inFlight = 0;
  let peak = 0;
  const fetchFn = async (): Promise<Response> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    const body = inFlight > 1 ? sseRefused : sseOk;
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;
    return new Response(body, { status: 200 });
  };
  return { fetchFn: fetchFn as unknown as typeof fetch, peak: () => peak };
}

const complete = (baseUrl: string, fetchFn: typeof fetch): Promise<string> =>
  createOpenAiCompatProvider({ name: "test", baseUrl, model: "m", fetchFn }).complete({
    messages: [{ role: "user", content: "hi" }],
    onDelta: () => undefined,
  });

describe("concurrent checks sharing one model server", () => {
  it("queues model calls rather than letting the server refuse the overlapping ones", async () => {
    // Two guardian checks at once used to fire both LLM turns together; the server refused all
    // but the first in-band, the refusal frame was skipped as unrecognised, and every caller got
    // "" back — a silent drop to a deterministic-only verdict after minutes of dead round-trips.
    const server = singleSlotServer();
    const call = (): Promise<string> => complete("http://model.test/queue", server.fetchFn);

    await expect(Promise.all([call(), call(), call()])).resolves.toEqual([
      '{"ok":true}',
      '{"ok":true}',
      '{"ok":true}',
    ]);
    expect(server.peak()).toBe(1);
  });

  it("surfaces an in-band stream error instead of returning empty content", async () => {
    const refuse = (async () =>
      new Response(sseRefused, { status: 200 })) as unknown as typeof fetch;

    await expect(complete("http://model.test/in-band", refuse)).rejects.toThrow(
      "Context size has been exceeded",
    );
  });

  it("reports the finish reason when a stream ends with no content", async () => {
    // A request the server refuses can also just end the stream empty. Returning "" here is what
    // used to reach the user as "no JSON object in model output:" — the wrong layer, no cause.
    const noContent =
      'data: {"choices":[{"delta":{"reasoning_content":"hmm"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const fetchFn = (async () =>
      new Response(noContent, { status: 200 })) as unknown as typeof fetch;

    await expect(complete("http://model.test/empty", fetchFn)).rejects.toThrow(
      /no content \(finish_reason stop, 3 chars of reasoning, max_tokens 2048\)/,
    );
  });
});

describe("abandoned checks release the model slot", () => {
  it("stops retrying once the caller has aborted", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      controller.abort(); // the client hangs up while the first attempt is in flight
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;

    // Without the abort check this retries 3 more times, holding the gate's one slot
    // through three backoff sleeps after the caller is already gone.
    await expect(
      fetchWithBackoff(
        "http://model.test/v1",
        { signal: controller.signal },
        { fetchFn, baseMs: 1 },
      ),
    ).rejects.toThrow(/request aborted/);
    expect(calls).toBe(1);
  });

  it("still retries a flaky network when nobody aborted", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("socket hang up");
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await fetchWithBackoff("http://model.test/v1", {}, { fetchFn, baseMs: 1 });
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });
});
