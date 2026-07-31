import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { callGuardianActionPlanLLM, callGuardianLLM } from "./client";

const server = setupServer(
  http.post("http://lm/v1/chat/completions", () =>
    HttpResponse.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "Calls transfer.",
              impacts: ["−1000 USDC from your wallet"],
              risk: "low",
              reasoning: "Plain ERC-20 transfer to a verified contract.",
            }),
          },
        },
      ],
    }),
  ),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

describe("callGuardianLLM", () => {
  it("returns a parsed verdict", async () => {
    const out = await callGuardianLLM({
      baseUrl: "http://lm/v1",
      apiKey: "k",
      model: "qwen",
      system: "be the guardian",
      user: "tx context",
    });
    expect(out?.risk).toBe("low");
    expect(out?.summary).toContain("transfer");
  });

  it("returns null when endpoint is unreachable", async () => {
    server.use(http.post("http://lm/v1/chat/completions", () => HttpResponse.error()));
    const out = await callGuardianLLM({
      baseUrl: "http://lm/v1",
      apiKey: "k",
      model: "qwen",
      system: "x",
      user: "y",
    });
    expect(out).toBeNull();
  });

  it("returns null on invalid JSON content (after one retry)", async () => {
    server.use(
      http.post("http://lm/v1/chat/completions", () =>
        HttpResponse.json({ choices: [{ message: { content: "not json" } }] }),
      ),
    );
    const out = await callGuardianLLM({
      baseUrl: "http://lm/v1",
      apiKey: "k",
      model: "qwen",
      system: "x",
      user: "y",
    });
    expect(out).toBeNull();
  });
});

describe("callGuardianActionPlanLLM", () => {
  it("returns a parsed action plan", async () => {
    server.use(
      http.post("http://lm/v1/chat/completions", () =>
        HttpResponse.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  actions: ["decode_calldata", "simulate_transaction"],
                  reasoning: "Call data and effects are needed.",
                }),
              },
            },
          ],
        }),
      ),
    );
    const out = await callGuardianActionPlanLLM({
      baseUrl: "http://lm/v1",
      apiKey: "k",
      model: "qwen",
      system: "plan",
      user: "tx",
    });
    expect(out?.actions).toEqual(["decode_calldata", "simulate_transaction"]);
  });

  it("parses action plans returned in reasoning_content", async () => {
    server.use(
      http.post("http://lm/v1/chat/completions", () =>
        HttpResponse.json({
          choices: [
            {
              message: {
                content: "",
                reasoning_content: JSON.stringify({
                  actions: ["get_contract_info"],
                  reasoning: "Plain ETH transfer - checking the recipient.",
                }),
              },
            },
          ],
        }),
      ),
    );
    const out = await callGuardianActionPlanLLM({
      baseUrl: "http://lm/v1",
      apiKey: "k",
      model: "qwen",
      system: "plan",
      user: "tx",
    });
    expect(out?.actions).toEqual(["get_contract_info"]);
  });
});

describe("callGuardianLLM streaming", () => {
  it("invokes onDelta with progressively-built summary and reasoning", async () => {
    server.use(
      http.post("http://lm/v1/chat/completions", () => {
        const body = [
          'data: {"choices":[{"delta":{"content":"{\\"summary\\":\\"Cal"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"ls transfer.\\","}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"\\"impacts\\":[],\\"risk\\":\\"low\\","}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"\\"reasoning\\":\\"Verified ERC-20.\\"}"}}]}\n\n',
          "data: [DONE]\n\n",
        ].join("");
        return new HttpResponse(body, {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );

    const deltas: { field: string; text: string }[] = [];
    const out = await callGuardianLLM({
      baseUrl: "http://lm/v1",
      apiKey: "k",
      model: "qwen",
      system: "x",
      user: "y",
      onDelta: (d) => deltas.push(d),
    });

    expect(out?.summary).toBe("Calls transfer.");
    expect(out?.reasoning).toBe("Verified ERC-20.");
    const summaryDeltas = deltas.filter((d) => d.field === "summary").map((d) => d.text);
    expect(summaryDeltas.length).toBeGreaterThan(0);
    expect(summaryDeltas[summaryDeltas.length - 1]).toBe("Calls transfer.");
    const reasoningDeltas = deltas.filter((d) => d.field === "reasoning").map((d) => d.text);
    expect(reasoningDeltas[reasoningDeltas.length - 1]).toBe("Verified ERC-20.");
  });

  it("handles SSE chunks that split mid-line across reads", async () => {
    server.use(
      http.post("http://lm/v1/chat/completions", () => {
        const parts = [
          'data: {"choices":[{"delta":{"content":"{\\"sum',
          'mary\\":\\"Streamed.\\",\\"impacts',
          '\\":[],\\"risk\\":\\"low\\",\\"reasoning\\":\\"Cite',
          'd evidence.\\"}"}}]}\n\ndata: [DONE]\n\n',
        ];
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const p of parts) controller.enqueue(enc.encode(p));
            controller.close();
          },
        });
        return new HttpResponse(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );

    const deltas: { field: string; text: string }[] = [];
    const out = await callGuardianLLM({
      baseUrl: "http://lm/v1",
      apiKey: "k",
      model: "qwen",
      system: "x",
      user: "y",
      onDelta: (d) => deltas.push(d),
    });

    expect(out?.summary).toBe("Streamed.");
    expect(out?.reasoning).toBe("Cited evidence.");
  });

  it("falls back to non-streaming when onDelta is omitted", async () => {
    server.use(
      http.post("http://lm/v1/chat/completions", () =>
        HttpResponse.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Calls transfer.",
                  impacts: ["−1000 USDC"],
                  risk: "low",
                  reasoning: "Verified.",
                }),
              },
            },
          ],
        }),
      ),
    );
    const out = await callGuardianLLM({
      baseUrl: "http://lm/v1",
      apiKey: "k",
      model: "qwen",
      system: "x",
      user: "y",
    });
    expect(out?.summary).toBe("Calls transfer.");
  });
});
