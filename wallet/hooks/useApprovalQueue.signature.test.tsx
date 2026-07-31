import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ApprovalQueueProvider, useApprovalQueue } from "./useApprovalQueue";
import type { UnlockedWallet } from "@/lib/wallet/wallet";

const wrapper = ({ children }: { children: ReactNode }) => (
  <ApprovalQueueProvider>{children}</ApprovalQueueProvider>
);

const fakeWallet = {
  address: "0xEoa",
  account: {
    signMessage: vi.fn(async () => "0xsig-msg"),
    signTypedData: vi.fn(async () => "0xsig-typed"),
  },
} as unknown as UnlockedWallet;

describe("approval queue signature requests", () => {
  it("submits a signature review and signs a message via the bridge", async () => {
    const onSigned = vi.fn();
    const { result } = renderHook(() => useApprovalQueue(), { wrapper });

    let id = "";
    act(() => {
      id = result.current.submitSignatureRequest(
        {
          method: "personal_sign",
          account: "0xEoa",
          origin: { name: "Uniswap", url: "https://app.uniswap.org" },
          view: { kind: "message", text: "hello" },
          raw: ["0x68656c6c6f", "0xEoa"],
        },
        { onSigned, onRejected: vi.fn() },
      );
    });

    await waitFor(() => expect(result.current.byId(id)).toBeDefined());
    expect(result.current.byId(id)?.signatureReview?.method).toBe("personal_sign");

    let sig = "";
    await act(async () => {
      sig = await result.current.signSignatureRequest(id, fakeWallet);
    });

    expect(sig).toBe("0xsig-msg");
    expect(fakeWallet.account.signMessage).toHaveBeenCalledWith({
      message: { raw: "0x68656c6c6f" },
    });
    expect(onSigned).toHaveBeenCalledWith("0xsig-msg");
    expect(result.current.byId(id)?.state).toBe("approved");
  });

  // Regression: dApps send EIP-712 over JSON, so domain.chainId arrives as a
  // string. viem silently drops a string chainId from the domain separator,
  // producing a valid-looking signature over the WRONG domain that Permit2
  // (and the dApp) reject. The signer must coerce chainId to a number so the
  // signature recovers under the canonical numeric-chainId domain.
  it("signs Permit2 typed data over the correct numeric-chainId domain", async () => {
    const account = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    const realWallet = { address: account.address, account } as unknown as UnlockedWallet;

    const types = {
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    };
    // chainId, amount, expiration, nonce, sigDeadline are all strings — exactly
    // as Uniswap sends them over WalletConnect (the bug-reproducing shape).
    const typedData = {
      types,
      domain: {
        name: "Permit2",
        chainId: "8453",
        verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      },
      primaryType: "PermitSingle",
      message: {
        details: {
          token: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
          amount: "1461501637330902918203684832716283019655932542975",
          expiration: "1782127888",
          nonce: "0",
        },
        spender: "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7",
        sigDeadline: "1779537688",
      },
    };

    const { result } = renderHook(() => useApprovalQueue(), { wrapper });
    let id = "";
    act(() => {
      id = result.current.submitSignatureRequest(
        {
          method: "eth_signTypedData_v4",
          account: account.address,
          origin: { name: "Uniswap", url: "https://app.uniswap.org" },
          view: { kind: "typedData", typedData },
          raw: [account.address, JSON.stringify(typedData)],
        },
        { onSigned: vi.fn(), onRejected: vi.fn() },
      );
    });
    await waitFor(() => expect(result.current.byId(id)).toBeDefined());

    let signature = "" as `0x${string}`;
    await act(async () => {
      signature = await result.current.signSignatureRequest(id, realWallet);
    });

    // Recover against the canonical NUMERIC-chainId domain — what Permit2 uses
    // on-chain. Without the fix the signature recovers to a different address.
    const { EIP712Domain: _omit, ...recoverTypes } = types;
    void _omit;
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "Permit2",
        chainId: 8453,
        verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      },
      types: recoverTypes,
      primaryType: "PermitSingle",
      message: typedData.message,
      signature,
    } as never);
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("fires onRejected when a signature review is rejected", async () => {
    const onRejected = vi.fn();
    const { result } = renderHook(() => useApprovalQueue(), { wrapper });
    let id = "";
    act(() => {
      id = result.current.submitSignatureRequest(
        {
          method: "personal_sign",
          account: "0xEoa",
          origin: { name: "d", url: "https://d" },
          view: { kind: "message", text: "x" },
          raw: ["0x78", "0xEoa"],
        },
        { onSigned: vi.fn(), onRejected },
      );
    });
    act(() => result.current.reject(id));
    expect(onRejected).toHaveBeenCalledOnce();
  });

  it("submits an eth_signTypedData_v4 signature review and invokes the Guardian with typedData", async () => {
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

    const typedData = {
      domain: {
        name: "Test",
        chainId: 8453,
        verifyingContract: "0x1111111111111111111111111111111111111111",
      },
      types: {
        TestType: [{ name: "value", type: "string" }],
      },
      primaryType: "TestType",
      message: { value: "hello" },
    };

    const { result } = renderHook(() => useApprovalQueue(), { wrapper });

    let id = "";
    act(() => {
      id = result.current.submitSignatureRequest(
        {
          method: "eth_signTypedData_v4",
          account: "0xEoa",
          origin: { name: "Uniswap", url: "https://app.uniswap.org" },
          view: { kind: "typedData", typedData },
          raw: ["0xEoa", JSON.stringify(typedData)],
        },
        { onSigned: vi.fn(), onRejected: vi.fn() },
      );
    });

    await waitFor(() => {
      expect(result.current.byId(id)?.live?.stage).toBe("ready");
    });

    expect(fetchMock).toHaveBeenCalled();
    const fetchArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(fetchArgs[1]?.body as string);
    expect(body.to).toBe("0x1111111111111111111111111111111111111111");
    expect(body.typedData).toBeDefined();
    expect(body.typedData.primaryType).toBe("TestType");
  });
});
