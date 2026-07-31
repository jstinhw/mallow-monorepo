import { describe, it, expect, beforeEach, vi } from "vitest";

describe("walletconnect client config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("isWalletConnectConfigured is false without a project id", async () => {
    vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "");
    const { isWalletConnectConfigured } = await import("./client");
    expect(isWalletConnectConfigured()).toBe(false);
  });

  it("isWalletConnectConfigured is true when project id is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "abc123");
    const { isWalletConnectConfigured } = await import("./client");
    expect(isWalletConnectConfigured()).toBe(true);
  });

  it("getWalletKit throws WalletConnectNotConfigured without a project id", async () => {
    vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "");
    const { getWalletKit, WalletConnectNotConfigured } = await import("./client");
    await expect(getWalletKit()).rejects.toBeInstanceOf(WalletConnectNotConfigured);
  });
});

describe("respondResult / respondError resilience", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "abc123");
  });

  // Load ./client with a WalletKit whose respondSessionRequest behaves as given.
  async function loadWithRespond(respond: () => Promise<void>) {
    vi.doMock("@walletconnect/core", () => ({
      Core: class {
        constructor() {
          /* stub */
        }
      },
    }));
    vi.doMock("@reown/walletkit", () => ({
      WalletKit: { init: async () => ({ respondSessionRequest: respond }) },
    }));
    return import("./client");
  }

  it("reports delivered:true when the relay accepts the response", async () => {
    const { respondResult } = await loadWithRespond(async () => {});
    await expect(respondResult("t", 1, "0xabc")).resolves.toEqual({ delivered: true });
  });

  it("reports delivered:false when the request was already deleted/expired", async () => {
    const { respondResult } = await loadWithRespond(async () => {
      throw new Error("Record was recently deleted - request: 1779537275938442");
    });
    await expect(respondResult("t", 1, "0xabc")).resolves.toEqual({ delivered: false });
  });

  it("swallows the stale-request error for respondError too", async () => {
    const { respondError } = await loadWithRespond(async () => {
      throw new Error("No matching key. session request: 123");
    });
    await expect(respondError("t", 1)).resolves.toEqual({ delivered: false });
  });

  it("rethrows genuine (non-stale) failures", async () => {
    const { respondResult } = await loadWithRespond(async () => {
      throw new Error("relay socket closed");
    });
    await expect(respondResult("t", 1, "0xabc")).rejects.toThrow("relay socket closed");
  });
});
