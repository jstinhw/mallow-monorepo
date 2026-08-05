/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApprovalQueueProvider, useApprovalQueue } from "./useApprovalQueue";
import { DEFAULT_CHAIN_ID } from "@/lib/constants/chains";
import type { Address } from "viem";

describe("useApprovalQueue.submitAgentInstallReview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("pushes a generic agent install item without calling Guardian", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useApprovalQueue(), {
      wrapper: ({ children }) => <ApprovalQueueProvider>{children}</ApprovalQueueProvider>,
    });

    let id = "";
    act(() => {
      id = result.current.submitAgentInstallReview({
        pluginId: "auto-invest",
        serviceUrl: "http://localhost:8787",
        mallowMainWallet: "0x1111111111111111111111111111111111111111" as Address,
        agentKey: "yield",
        request: {
          name: "Sprout",
          description: "Moves idle USDC into vetted yield venues.",
          accounts: [],
          actions: [
            {
              kind: "tx",
              chainId: DEFAULT_CHAIN_ID,
              to: "0x1111111111111111111111111111111111111111",
              data: "0x",
              value: "0",
            },
          ],
        },
      });
    });

    const initial = result.current.byId(id);
    expect(initial?.agent).toBe("yield");
    expect(initial?.intent).toBe("Install Sprout");
    expect(initial?.agentInstall?.kind).toBe("agent-install");
    expect(initial?.agentInstall?.mallowMainWallet).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends live guardian checks directly to the guardian service", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: verdict\ndata: {"risk":"info","summary":"ok","impacts":[],"findings":[],"decoded":{"selector":"0x"},"simulation":null,"llm":null,"checks":[],"meta":{"durationMs":1,"simulator":"anvil-fork"}}\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(stream, { headers: { "content-type": "text/event-stream" } }),
      );
    const { result } = renderHook(() => useApprovalQueue(), {
      wrapper: ({ children }) => <ApprovalQueueProvider>{children}</ApprovalQueueProvider>,
    });

    act(() => {
      result.current.submitLive({
        from: "0x1111111111111111111111111111111111111111" as Address,
        to: "0x2222222222222222222222222222222222222222" as Address,
        value: 0n,
        data: "0x",
        chainId: DEFAULT_CHAIN_ID,
      });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3003/check");
  });

  it("surfaces guardian service error responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "chain 10 not configured" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const { result } = renderHook(() => useApprovalQueue(), {
      wrapper: ({ children }) => <ApprovalQueueProvider>{children}</ApprovalQueueProvider>,
    });

    let id = "";
    act(() => {
      id = result.current.submitLive({
        from: "0x1111111111111111111111111111111111111111" as Address,
        to: "0x2222222222222222222222222222222222222222" as Address,
        value: 0n,
        data: "0x",
        chainId: 10,
      });
    });

    await waitFor(() => expect(result.current.byId(id)?.live?.stage).toBe("error"));
    expect(result.current.byId(id)?.live?.error).toBe(
      "guardian service 400: chain 10 not configured",
    );
  });

  it("surfaces unreachable guardian service failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const { result } = renderHook(() => useApprovalQueue(), {
      wrapper: ({ children }) => <ApprovalQueueProvider>{children}</ApprovalQueueProvider>,
    });

    let id = "";
    act(() => {
      id = result.current.submitLive({
        from: "0x1111111111111111111111111111111111111111" as Address,
        to: "0x2222222222222222222222222222222222222222" as Address,
        value: 0n,
        data: "0x",
        chainId: DEFAULT_CHAIN_ID,
      });
    });

    await waitFor(() => expect(result.current.byId(id)?.live?.stage).toBe("error"));
    expect(result.current.byId(id)?.live?.error).toBe(
      "guardian service unreachable at http://localhost:3003/check",
    );
  });
});
