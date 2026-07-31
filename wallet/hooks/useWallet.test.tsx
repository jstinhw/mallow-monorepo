import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { WalletProvider, useWallet } from "./useWallet";
import { restoreConnectedWallet, restorePasskeySessionWallet } from "@/lib/wallet/wallet";
import { loadWallet } from "@/lib/wallet/storage";
import type { ReactNode } from "react";
import type { Address } from "viem";
import type { StoredWallet } from "@/lib/wallet/storage";
import type { UnlockedWallet } from "@/lib/wallet/wallet";

type PasskeyWallet = Extract<UnlockedWallet, { kind: "passkey" }>;
type InjectedWallet = Extract<UnlockedWallet, { kind: "injected" }>;

const wagmiMocks = vi.hoisted(() => ({
  connection: {
    address: undefined as Address | undefined,
    isConnected: false,
    connector: null as unknown,
    status: "disconnected" as const,
  },
  connectors: [] as unknown[],
  connect: { mutateAsync: vi.fn() },
  disconnect: { mutateAsync: vi.fn() },
}));

vi.mock("wagmi", () => ({
  useConnection: () => wagmiMocks.connection,
  useConnect: () => wagmiMocks.connect,
  useConnectors: () => wagmiMocks.connectors,
  useDisconnect: () => wagmiMocks.disconnect,
}));

vi.mock("@/lib/wallet/storage", () => ({
  activeWalletKind: (wallet: StoredWallet) =>
    wallet.kind === "injected" || wallet.activeInjectedWallet ? "injected" : "passkey",
  deleteWallet: vi.fn(),
  loadWallet: vi.fn(),
  saveWallet: vi.fn(),
}));

vi.mock("@/lib/wallet/wallet", () => ({
  clearPasskeySession: vi.fn(),
  connectInjectedWallet: vi.fn(),
  createWallet: vi.fn(),
  exportPrivateKey: vi.fn(),
  restoreConnectedWallet: vi.fn(),
  restorePasskeySessionWallet: vi.fn(),
  unlockWallet: vi.fn(),
}));

const passkeyAddress = "0x1111111111111111111111111111111111111111" as Address;
const injectedAddress = "0x00000000000000000000000000000000000000aa" as Address;

function wrapper({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

describe("useWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores a passkey session after refresh without showing the unlock gate", async () => {
    vi.mocked(loadWallet).mockResolvedValue({
      kind: "passkey",
      id: "passkey-wallet",
      address: passkeyAddress,
      credentialId: new Uint8Array([1]),
      ciphertext: new Uint8Array([2]),
      iv: new Uint8Array([3]),
      hkdfSalt: new Uint8Array([4]),
      prfSalt: new Uint8Array([5]),
      createdAt: 1,
    });
    vi.mocked(restorePasskeySessionWallet).mockResolvedValue({
      kind: "passkey",
      address: passkeyAddress,
      account: {
        address: passkeyAddress,
        signMessage: vi.fn(),
        signTypedData: vi.fn(),
      } as unknown as PasskeyWallet["account"],
      client: {} as PasskeyWallet["client"],
    } satisfies PasskeyWallet);

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(result.current.state.kind).toBe("unlocked"));
    expect(restorePasskeySessionWallet).toHaveBeenCalledTimes(1);
    expect(restoreConnectedWallet).not.toHaveBeenCalled();
    if (result.current.state.kind !== "unlocked") throw new Error("expected unlocked");
    expect(result.current.state.wallet.kind).toBe("passkey");
    expect(result.current.state.wallet.address).toBe(passkeyAddress);
  });

  it("restores an active injected connection without replacing the stored passkey", async () => {
    vi.mocked(loadWallet).mockResolvedValue({
      kind: "passkey",
      id: "passkey-wallet",
      address: passkeyAddress,
      credentialId: new Uint8Array([1]),
      ciphertext: new Uint8Array([2]),
      iv: new Uint8Array([3]),
      hkdfSalt: new Uint8Array([4]),
      prfSalt: new Uint8Array([5]),
      createdAt: 1,
      activeInjectedWallet: {
        kind: "injected",
        address: injectedAddress,
        rdns: "io.metamask",
        connectedAt: 2,
      },
    });
    vi.mocked(restoreConnectedWallet).mockResolvedValue({
      kind: "injected",
      address: injectedAddress,
      account: { address: injectedAddress, signMessage: vi.fn(), signTypedData: vi.fn() },
      client: {} as InjectedWallet["client"],
      provider: { request: vi.fn() },
    } satisfies InjectedWallet);

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(result.current.state.kind).toBe("unlocked"));
    expect(restoreConnectedWallet).toHaveBeenCalledTimes(1);
    if (result.current.state.kind !== "unlocked") throw new Error("expected unlocked");
    expect(result.current.state.wallet.kind).toBe("injected");
    expect(result.current.state.wallet.address).toBe(injectedAddress);
  });

  it("shows the active injected address when silent restore is unavailable", async () => {
    vi.mocked(loadWallet).mockResolvedValue({
      kind: "passkey",
      id: "passkey-wallet",
      address: passkeyAddress,
      credentialId: new Uint8Array([1]),
      ciphertext: new Uint8Array([2]),
      iv: new Uint8Array([3]),
      hkdfSalt: new Uint8Array([4]),
      prfSalt: new Uint8Array([5]),
      createdAt: 1,
      activeInjectedWallet: {
        kind: "injected",
        address: injectedAddress,
        rdns: "io.metamask",
        connectedAt: 2,
      },
    });
    vi.mocked(restoreConnectedWallet).mockResolvedValue(null);

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(result.current.state.kind).toBe("locked"));
    expect(result.current.state).toMatchObject({
      kind: "locked",
      address: injectedAddress,
      walletKind: "injected",
    });
  });
});
