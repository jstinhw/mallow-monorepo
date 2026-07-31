import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startAnvil, simulateOnAnvil, shutdownAnvil, type AnvilHandle } from "./anvil";

const key = process.env.ALCHEMY_API_KEY;
const RPC = key
  ? key.startsWith("http://") || key.startsWith("https://")
    ? key
    : `https://arb-mainnet.g.alchemy.com/v2/${key}`
  : undefined;
const skip = !RPC;

describe.skipIf(skip)("anvil fork lifecycle", () => {
  let handle: AnvilHandle;

  beforeAll(async () => {
    handle = await startAnvil(RPC!);
  }, 30_000);

  afterAll(async () => {
    await shutdownAnvil(handle);
  });

  it("starts and reports a port", async () => {
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("simulates a pure ETH transfer with impersonation", async () => {
    const result = await simulateOnAnvil(handle, {
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000002",
      value: 10n ** 16n,
      data: "0x",
    });
    expect(result.success).toBe(true);
    const delta = result.balanceChanges.find(
      (b) => b.address.toLowerCase() === "0x0000000000000000000000000000000000000002",
    );
    expect(delta?.deltaWei).toBeGreaterThan(0n);
  }, 30_000);

  it("snapshot/revert isolates state between calls", async () => {
    const a = await simulateOnAnvil(handle, {
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000003",
      value: 10n ** 15n,
      data: "0x",
    });
    const b = await simulateOnAnvil(handle, {
      from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000003",
      value: 10n ** 15n,
      data: "0x",
    });
    expect(a.balanceChanges).toEqual(b.balanceChanges);
  }, 30_000);
});
