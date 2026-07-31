import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../app";

vi.mock("../guardian/check", () => ({
  runGuardian: async ({ onProgress }: { onProgress: (e: unknown) => void }) => {
    onProgress({ stage: "plan" });
    return { risk: "info", summary: "ok" };
  },
}));

describe("POST /check", () => {
  it("streams progress then verdict", async () => {
    process.env.ALCHEMY_API_KEY = "http://localhost:8545";
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/check",
      payload: {
        chainId: 42161,
        from: "0x" + "1".repeat(40),
        to: "0x" + "2".repeat(40),
        value: "0",
        data: "0x",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: progress");
    expect(res.body).toContain("event: verdict");
    await app.close();
  });

  it("includes CORS headers on streamed check responses", async () => {
    process.env.ALCHEMY_API_KEY = "http://localhost:8545";
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/check",
      headers: { origin: "http://localhost:3000" },
      payload: {
        chainId: 42161,
        from: "0x" + "1".repeat(40),
        to: "0x" + "2".repeat(40),
        value: "0",
        data: "0x",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    await app.close();
  });

  it("400s on unconfigured chain", async () => {
    delete process.env.ALCHEMY_API_KEY;
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/check",
      payload: {
        chainId: 42161,
        from: "0x" + "1".repeat(40),
        to: "0x" + "2".repeat(40),
        value: "0",
        data: "0x",
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
