import { describe, expect, it } from "vitest";
import { parseAgentInstallResponse, parseAgentRequest } from "./protocol-schemas";

describe("agent protocol validation", () => {
  it("parses a tx action and defaults missing kind to tx", () => {
    const request = parseAgentRequest({
      name: "Sprout",
      description: "Moves idle USDC into vetted yield venues.",
      accounts: [
        {
          address: "0x1111111111111111111111111111111111111111",
          type: "eoa",
          data: "0x1234",
        },
      ],
      actions: [
        {
          chainId: 8453,
          to: "0x2222222222222222222222222222222222222222",
          data: "0x",
          value: "0",
        },
      ],
    });

    expect(request.name).toBe("Sprout");
    expect(request.actions[0].kind).toBe("tx");
    if (request.actions[0].kind === "tx") {
      expect(request.actions[0].value).toBe("0");
    }
  });

  it("parses a sig action carrying EIP-712 typed data", () => {
    const request = parseAgentRequest({
      name: "Sprout",
      description: "Test",
      accounts: [],
      actions: [
        {
          kind: "sig",
          chainId: 8453,
          signer: "0x1111111111111111111111111111111111111111",
          payload: {
            type: "typedData",
            typedData: {
              domain: { name: "Kernel", version: "0.3.3", chainId: 8453 },
              types: { Enable: [{ name: "nonce", type: "uint32" }] },
              primaryType: "Enable",
              message: { nonce: 1 },
            },
          },
        },
      ],
    });

    const action = request.actions[0];
    expect(action.kind).toBe("sig");
    if (action.kind === "sig" && action.payload.type === "typedData") {
      expect(action.signer).toBe("0x1111111111111111111111111111111111111111");
      expect(action.payload.typedData.primaryType).toBe("Enable");
      expect(action.payload.typedData.message.nonce).toBe(1);
    }
  });

  it("parses a sig action carrying a raw message", () => {
    const request = parseAgentRequest({
      name: "Sprout",
      description: "Test",
      accounts: [],
      actions: [
        {
          kind: "sig",
          chainId: 8453,
          signer: "0x1111111111111111111111111111111111111111",
          payload: { type: "message", message: "0xdeadbeef" },
        },
      ],
    });

    const action = request.actions[0];
    expect(action.kind).toBe("sig");
    if (action.kind === "sig" && action.payload.type === "message") {
      expect(action.payload.message).toBe("0xdeadbeef");
    }
  });

  it("rejects a tx action with a non-integer value string", () => {
    expect(() =>
      parseAgentRequest({
        name: "Bad",
        description: "Bad request",
        accounts: [],
        actions: [
          {
            chainId: 8453,
            to: "0x2222222222222222222222222222222222222222",
            data: "0x",
            value: "1.2",
          },
        ],
      }),
    ).toThrow(/value/);
  });

  it("rejects an unknown action kind", () => {
    expect(() =>
      parseAgentRequest({
        name: "Bad",
        description: "Bad request",
        accounts: [],
        actions: [{ kind: "weird", chainId: 8453 }],
      }),
    ).toThrow(/kind/);
  });

  it("parses install response", () => {
    expect(parseAgentInstallResponse({ agentId: "sprout-1" })).toEqual({
      agentId: "sprout-1",
    });
  });
});
