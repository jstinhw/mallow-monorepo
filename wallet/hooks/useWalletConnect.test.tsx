import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

function dispatch(ev: string, e: unknown) {
  (mocks.handlers[ev] ?? []).forEach((h) => h(e));
}

const mocks = vi.hoisted(() => ({
  submitLive: vi.fn(() => "live-1"),
  submitSignatureRequest: vi.fn(() => "sig-1"),
  pair: vi.fn(async () => {}),
  approveSession: vi.fn(async () => {}),
  rejectSession: vi.fn(async () => {}),
  respondResult: vi.fn(async () => ({ delivered: true })),
  respondError: vi.fn(async () => ({ delivered: true })),
  disconnectSession: vi.fn(async () => {}),
  handlers: {} as Record<string, ((e: unknown) => void)[]>,
  getActiveSessions: vi.fn(() => ({})),
}));

vi.mock("@/hooks/useApprovalQueue", () => ({
  useApprovalQueue: () => ({
    submitLive: mocks.submitLive,
    submitSignatureRequest: mocks.submitSignatureRequest,
  }),
}));
vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ state: { kind: "locked", address: "0xEoa" } }),
}));
vi.mock("@/lib/walletconnect/client", () => ({
  isWalletConnectConfigured: () => true,
  getWalletKit: async () => ({
    on: (ev: string, cb: (e: unknown) => void) => {
      (mocks.handlers[ev] ??= []).push(cb);
    },
    off: (ev: string, cb: (e: unknown) => void) => {
      mocks.handlers[ev] = (mocks.handlers[ev] ?? []).filter((h) => h !== cb);
    },
    getActiveSessions: mocks.getActiveSessions,
  }),
  pair: mocks.pair,
  approveSession: mocks.approveSession,
  rejectSession: mocks.rejectSession,
  respondResult: mocks.respondResult,
  respondError: mocks.respondError,
  disconnectSession: mocks.disconnectSession,
}));

import { WalletConnectProvider, useWalletConnect } from "./useWalletConnect";

const tree = (children: ReactNode) => <WalletConnectProvider>{children}</WalletConnectProvider>;

describe("useWalletConnect", () => {
  beforeEach(() => {
    Object.values(mocks).forEach(
      (m) => typeof m === "function" && (m as ReturnType<typeof vi.fn>).mockClear?.(),
    );
    mocks.handlers = {};
  });

  it("exposes a pendingProposal when session_proposal fires, and approves it", async () => {
    const { result } = renderHook(() => useWalletConnect(), {
      wrapper: ({ children }) => tree(children),
    });
    await waitFor(() => expect(mocks.handlers["session_proposal"]?.length).toBeGreaterThan(0));
    await act(async () => {
      dispatch("session_proposal", {
        id: 5,
        params: {
          proposer: { metadata: { name: "Uniswap", url: "https://app.uniswap.org", icons: [] } },
        },
      });
    });
    expect(result.current.pendingProposal?.name).toBe("Uniswap");
    await act(async () => {
      await result.current.approveProposal();
    });
    expect(mocks.approveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 5, eoa: "0xEoa" }),
    );
  });
});
