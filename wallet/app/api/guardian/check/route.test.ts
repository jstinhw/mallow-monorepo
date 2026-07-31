import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("guardian check proxy route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("forwards the body to the guardian service and pipes SSE back", async () => {
    vi.stubEnv("NEXT_PUBLIC_GUARDIAN_AGENT_URL", "http://guardian.local");
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: progress\ndata: {"stage":"plan"}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(upstream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("http://wallet.local/api/guardian/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"chainId":8453}',
    });
    const res = await POST(req);

    expect(fetchMock).toHaveBeenCalledWith(new URL("/check", "http://guardian.local"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"chainId":8453}',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toContain("event: progress");
  });

  it("returns 502 when the guardian service cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    const res = await POST(
      new Request("http://wallet.local/api/guardian/check", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(res.status).toBe(502);
    expect(await res.text()).toBe("guardian service unreachable");
  });
});
