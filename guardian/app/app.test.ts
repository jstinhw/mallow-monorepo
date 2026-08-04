import { describe, expect, it } from "vitest";
import { buildServer, type AnalyzeFn } from "./app";
import type { AgentReport } from "../agent/agent";

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

  it("rejects a value-bearing call, which the tracer cannot observe", async () => {
    const res = await buildServer(fakeAnalyze).inject({
      method: "POST",
      url: "/check",
      payload: { ...VALID_BODY, value: "1000000000000000000" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toContain("value: value-bearing calls are not traced; send value 0");
  });
});
