import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { lookupSignature, _resetCache } from "./client";

const server = setupServer();

beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  _resetCache();
});

describe("lookupSignature", () => {
  it("returns signatures from openchain response", async () => {
    server.use(
      http.get("https://api.openchain.xyz/signature-database/v1/lookup", () =>
        HttpResponse.json({
          ok: true,
          result: {
            function: {
              "0xa9059cbb": [{ name: "transfer(address,uint256)", filtered: false }],
            },
          },
        }),
      ),
    );
    const sigs = await lookupSignature("0xa9059cbb");
    expect(sigs).toEqual(["transfer(address,uint256)"]);
  });

  it("filters out spam/collisions flagged as filtered", async () => {
    server.use(
      http.get("https://api.openchain.xyz/signature-database/v1/lookup", () =>
        HttpResponse.json({
          ok: true,
          result: {
            function: {
              "0x095ea7b3": [
                { name: "approve(address,uint256)", filtered: false },
                { name: "spam_sig()", filtered: true },
              ],
            },
          },
        }),
      ),
    );
    const sigs = await lookupSignature("0x095ea7b3");
    expect(sigs).toEqual(["approve(address,uint256)"]);
  });

  it("returns empty array on 4xx response", async () => {
    server.use(
      http.get("https://api.openchain.xyz/signature-database/v1/lookup", () =>
        HttpResponse.json({ ok: false }, { status: 404 }),
      ),
    );
    const sigs = await lookupSignature("0xdeadbeef");
    expect(sigs).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    server.use(
      http.get("https://api.openchain.xyz/signature-database/v1/lookup", () =>
        HttpResponse.error(),
      ),
    );
    const sigs = await lookupSignature("0xcafebabe");
    expect(sigs).toEqual([]);
  });

  it("rejects malformed selectors without making a request", async () => {
    let called = 0;
    server.use(
      http.get("https://api.openchain.xyz/signature-database/v1/lookup", () => {
        called++;
        return HttpResponse.json({ ok: true, result: { function: {} } });
      }),
    );
    const sigs = await lookupSignature("0xzz" as `0x${string}`);
    expect(sigs).toEqual([]);
    expect(called).toBe(0);
  });

  it("caches results by selector", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.openchain.xyz/signature-database/v1/lookup", () => {
        calls++;
        return HttpResponse.json({
          ok: true,
          result: { function: { "0xa9059cbb": [{ name: "transfer(address,uint256)" }] } },
        });
      }),
    );
    await lookupSignature("0xa9059cbb");
    await lookupSignature("0xa9059cbb");
    expect(calls).toBe(1);
  });

  it("dedupes in-flight requests", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.openchain.xyz/signature-database/v1/lookup", async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({
          ok: true,
          result: { function: { "0xa9059cbb": [{ name: "transfer(address,uint256)" }] } },
        });
      }),
    );
    const [a, b] = await Promise.all([
      lookupSignature("0xa9059cbb"),
      lookupSignature("0xa9059cbb"),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });
});
