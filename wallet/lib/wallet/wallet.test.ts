import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

vi.mock("./passkey", () => {
  const credId = new Uint8Array([9, 9, 9]);
  return {
    prfSupported: vi.fn(() => true),
    registerPasskey: vi.fn(async () => ({
      credentialId: credId,
      prfOutput: new Uint8Array(32).fill(1),
    })),
    getPrfFromPasskey: vi.fn(async () => new Uint8Array(32).fill(1)),
  };
});

import { deleteWallet, loadWallet } from "./storage";
import { getPrfFromPasskey } from "./passkey";
import {
  clearPasskeySession,
  connectInjectedWallet,
  createWallet,
  exportPrivateKey,
  restoreConnectedWallet,
  restorePasskeySessionWallet,
  unlockWallet,
} from "./wallet";

const injectedAddress = "0x00000000000000000000000000000000000000aa";

beforeEach(async () => {
  await deleteWallet();
  sessionStorage.clear();
  Reflect.deleteProperty(globalThis, "ethereum");
});

describe("wallet flows", () => {
  it("create then unlock yields the same private key", async () => {
    const created = await createWallet();
    const stored = await loadWallet();
    expect(stored?.address).toBe(created.address);

    const unlocked = await unlockWallet();
    expect(unlocked.address).toBe(created.address);
    expect(unlocked.account.address).toBe(created.address);
  });

  it("exports a private key for the same wallet address", async () => {
    const created = await createWallet();

    const privateKey = await exportPrivateKey();
    const account = privateKeyToAccount(privateKey);

    expect(account.address).toBe(created.address);
  });

  it("restores a passkey session across refresh without another passkey ceremony", async () => {
    const created = await createWallet();
    const unlocked = await unlockWallet();
    expect(unlocked.kind).toBe("passkey");
    vi.mocked(getPrfFromPasskey).mockClear();

    const restored = await restorePasskeySessionWallet();

    expect(restored?.kind).toBe("passkey");
    expect(restored?.address).toBe(created.address);
    expect(getPrfFromPasskey).not.toHaveBeenCalled();

    clearPasskeySession();
    await expect(restorePasskeySessionWallet()).resolves.toBeNull();
  });

  it("keeps an injected wallet connected across refresh without replacing the passkey wallet", async () => {
    await createWallet();
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") return [injectedAddress];
        if (method === "eth_accounts") return [injectedAddress];
        if (method === "eth_chainId") return "0xa4b1";
        return null;
      }),
    };
    Object.defineProperty(globalThis, "ethereum", { configurable: true, value: provider });

    const connected = await connectInjectedWallet({ provider });
    expect(connected.kind).toBe("injected");

    const stored = await loadWallet();
    expect(stored?.kind).toBe("passkey");
    if (!stored || stored.kind === "injected") throw new Error("expected passkey wallet");
    expect(stored.activeInjectedWallet?.address).toBe(connected.address);

    const restored = await restoreConnectedWallet();
    expect(restored?.kind).toBe("injected");
    expect(restored?.address).toBe(connected.address);
    expect(provider.request).toHaveBeenCalledWith({ method: "eth_accounts" });
  });

  it("rejects injected signatures when MetaMask selected account changes after connect", async () => {
    const otherAddress = "0x00000000000000000000000000000000000000bb";
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") return [injectedAddress];
        if (method === "eth_accounts") return [otherAddress];
        if (method === "eth_chainId") return "0xa4b1";
        if (method === "eth_signTypedData_v4") return "0xsig";
        return null;
      }),
    };

    const connected = await connectInjectedWallet({ provider });
    await expect(
      connected.account.signTypedData({
        domain: { name: "Kernel", version: "0.3.3", chainId: 42161 },
        types: { Enable: [{ name: "nonce", type: "uint32" }] },
        primaryType: "Enable",
        message: { nonce: 1 },
      }),
    ).rejects.toThrow(/Browser wallet selected account is/);
    expect(provider.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "eth_signTypedData_v4" }),
    );
  });

  it("injects the EIP712Domain type into eth_signTypedData_v4 so MetaMask hashes the full document", async () => {
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") return [injectedAddress];
        if (method === "eth_accounts") return [injectedAddress];
        if (method === "eth_chainId") return "0xa4b1";
        if (method === "eth_signTypedData_v4") return "0xsig";
        return null;
      }),
    };

    const connected = await connectInjectedWallet({ provider });
    await connected.account.signTypedData({
      domain: {
        name: "Kernel",
        version: "0.3.3",
        chainId: 42161,
        verifyingContract: injectedAddress,
      },
      types: { Enable: [{ name: "nonce", type: "uint32" }] },
      primaryType: "Enable",
      message: { nonce: 1 },
    });

    const signCall = provider.request.mock.calls.find(
      ([params]) => params.method === "eth_signTypedData_v4",
    )?.[0] as { method: string; params: [string, string] } | undefined;
    if (!signCall) throw new Error("expected eth_signTypedData_v4 to be called");
    const sent = JSON.parse(signCall.params[1]);
    expect(sent.types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ]);
    expect(sent.types.Enable).toEqual([{ name: "nonce", type: "uint32" }]);
  });
});
