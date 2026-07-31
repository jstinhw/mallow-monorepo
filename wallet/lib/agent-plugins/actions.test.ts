import { describe, expect, it, vi } from "vitest";
import type { AgentRequest } from "@mallow/agents-protocol";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { UnlockedWallet } from "@/lib/wallet/wallet";
import { executeAgentRequestActions } from "./actions";

const WALLET_A = "0x1111111111111111111111111111111111111111" as Address;
const WALLET_B = "0x2222222222222222222222222222222222222222" as Address;
const ACCOUNT_A = privateKeyToAccount(("0x" + "11".repeat(32)) as Hex);
const ACCOUNT_B = privateKeyToAccount(("0x" + "22".repeat(32)) as Hex);

function makeSigRequest(signer: Address): AgentRequest {
  return {
    name: "Sprout",
    description: "Moves idle USDC.",
    accounts: [],
    actions: [
      {
        kind: "sig",
        chainId: 42161,
        signer,
        payload: {
          type: "typedData",
          typedData: {
            domain: { name: "Kernel", version: "0.3.3", chainId: 42161 },
            types: { Enable: [{ name: "nonce", type: "uint32" }] },
            primaryType: "Enable",
            message: { nonce: 1 },
          },
        },
      },
    ],
  };
}

describe("executeAgentRequestActions", () => {
  it("rejects a signature action when the active wallet is not the requested signer", async () => {
    const signTypedData = vi.fn(async () => "0xsig" as Hex);
    const wallet = {
      kind: "injected",
      address: WALLET_A,
      account: {
        address: WALLET_A,
        signTypedData,
        signMessage: vi.fn(),
      },
    } as unknown as UnlockedWallet;

    await expect(
      executeAgentRequestActions({ request: makeSigRequest(WALLET_B), wallet }),
    ).rejects.toThrow(/active wallet is 0x1111111111111111111111111111111111111111/);
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("rejects a typed-data signature that recovers to a different signer", async () => {
    const request = makeSigRequest(ACCOUNT_A.address);
    const typedData =
      request.actions[0].kind === "sig" && request.actions[0].payload.type === "typedData"
        ? request.actions[0].payload.typedData
        : null;
    if (!typedData) throw new Error("expected typedData request");

    const signatureFromWrongAccount = await ACCOUNT_B.signTypedData(typedData as never);
    const wallet = {
      kind: "injected",
      address: ACCOUNT_A.address,
      account: {
        address: ACCOUNT_A.address,
        signTypedData: vi.fn(async () => signatureFromWrongAccount),
        signMessage: vi.fn(),
      },
    } as unknown as UnlockedWallet;

    await expect(executeAgentRequestActions({ request, wallet })).rejects.toThrow(
      new RegExp(`recovered ${ACCOUNT_B.address}`),
    );
  });
});
