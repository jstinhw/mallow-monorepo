import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { GuardianInput } from "../../protocol";
import type { ToolContext } from "./types";

vi.mock("../../cast", () => ({
  getCode: vi.fn(async () => "0x"),
}));

vi.mock("../../etherscan/client", () => ({
  fetchContractInfo: vi.fn(async (address: Address) => ({
    address,
    verified: true,
    name: "KnownContract",
    isProxy: false,
  })),
}));

vi.mock("../../config", () => ({
  CHAINS: [
    { chainId: 42161, name: "Arbitrum" },
    { chainId: 1, name: "Ethereum" },
  ],
  rpcUrlForChain: vi.fn((chainId: number) => {
    if (chainId === 42161 || chainId === 1) return "https://rpc.example";
    return undefined;
  }),
  etherscanKey: vi.fn(() => "etherscan-key"),
}));

import { getCode } from "../../cast";
import { fetchContractInfo } from "../../etherscan/client";
import { getContractInfoTool } from "./get-contract-info";

const mockedGetCode = getCode as unknown as ReturnType<typeof vi.fn>;
const mockedFetchContractInfo = fetchContractInfo as unknown as ReturnType<typeof vi.fn>;

const TARGET = "0x0000000000000000000000000000000000000abc" as Address;

function okResult(result: Awaited<ReturnType<typeof getContractInfoTool.execute>>) {
  if (!result.ok) throw new Error(result.error);
  return result.result;
}

function makeCtx(): ToolContext {
  const input: GuardianInput = {
    chainId: 42161,
    from: "0x0000000000000000000000000000000000000001",
    to: TARGET,
    value: 1n,
    data: "0x",
  };
  return {
    input,
    cfg: { rpcUrl: "https://rpc.example", etherscanKey: "etherscan-key" },
    contractCache: new Map(),
    findings: [],
    anvil: {
      handle: null,
      invalidateLocal() {},
      async ensureStarted() {
        throw new Error("not needed");
      },
    },
  };
}

function mockEtherscanHistory(opts: { outgoingChainId?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      const action = url.searchParams.get("action");
      const chainId = Number(url.searchParams.get("chainid"));
      if (action === "txlist" && chainId === opts.outgoingChainId) {
        return Response.json({
          status: "1",
          message: "OK",
          result: [
            {
              hash: "0xsent",
              from: TARGET,
              to: "0x0000000000000000000000000000000000000002",
            },
          ],
        });
      }
      return Response.json({ status: "0", message: "No transactions found", result: [] });
    }),
  );
}

describe("get_contract_info execute", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockedGetCode.mockReset();
    mockedGetCode.mockResolvedValue("0x");
    mockedFetchContractInfo.mockClear();
  });

  it("does not classify a no-code address as an EOA without outgoing normal transaction evidence", async () => {
    mockEtherscanHistory();

    const result = okResult(await getContractInfoTool.execute({}, makeCtx()));

    expect(result).toMatchObject({
      kind: "empty-or-undeployed",
      address: TARGET,
      sentNormalTx: false,
    });
    expect(mockedFetchContractInfo).not.toHaveBeenCalled();
  });

  it("treats undefined code as no runtime code instead of fetching contract source", async () => {
    mockedGetCode.mockResolvedValue(undefined);
    mockEtherscanHistory({ outgoingChainId: 42161 });

    const result = okResult(await getContractInfoTool.execute({}, makeCtx()));

    expect(result).toMatchObject({
      kind: "eoa",
      address: TARGET,
      sentNormalTx: true,
      sentNormalTxChainId: 42161,
    });
    expect(mockedFetchContractInfo).not.toHaveBeenCalled();
  });

  it("treats empty string code as no runtime code instead of fetching contract source", async () => {
    mockedGetCode.mockResolvedValue("");
    mockEtherscanHistory({ outgoingChainId: 42161 });

    const result = okResult(await getContractInfoTool.execute({}, makeCtx()));

    expect(result).toMatchObject({
      kind: "eoa",
      address: TARGET,
      sentNormalTx: true,
      sentNormalTxChainId: 42161,
    });
    expect(mockedFetchContractInfo).not.toHaveBeenCalled();
  });

  it("treats 0x0 code as no runtime code instead of fetching contract source", async () => {
    mockedGetCode.mockResolvedValue("0x0");
    mockEtherscanHistory({ outgoingChainId: 42161 });

    const result = okResult(await getContractInfoTool.execute({}, makeCtx()));

    expect(result).toMatchObject({
      kind: "eoa",
      address: TARGET,
      sentNormalTx: true,
      sentNormalTxChainId: 42161,
    });
    expect(mockedFetchContractInfo).not.toHaveBeenCalled();
  });

  it("treats 0x00 code as no runtime code instead of fetching contract source", async () => {
    mockedGetCode.mockResolvedValue("0x00");
    mockEtherscanHistory({ outgoingChainId: 42161 });

    const result = okResult(await getContractInfoTool.execute({}, makeCtx()));

    expect(result).toMatchObject({
      kind: "eoa",
      address: TARGET,
      sentNormalTx: true,
      sentNormalTxChainId: 42161,
    });
    expect(mockedFetchContractInfo).not.toHaveBeenCalled();
  });

  it("treats null code as no runtime code instead of fetching contract source", async () => {
    mockedGetCode.mockResolvedValue(null);
    mockEtherscanHistory({ outgoingChainId: 42161 });

    const result = okResult(await getContractInfoTool.execute({}, makeCtx()));

    expect(result).toMatchObject({
      kind: "eoa",
      address: TARGET,
      sentNormalTx: true,
      sentNormalTxChainId: 42161,
    });
    expect(mockedFetchContractInfo).not.toHaveBeenCalled();
  });

  it("classifies a no-code address as EOA when it sent a normal transaction on any supported chain", async () => {
    mockEtherscanHistory({ outgoingChainId: 1 });

    const result = okResult(await getContractInfoTool.execute({}, makeCtx()));

    expect(result).toMatchObject({
      kind: "eoa",
      address: TARGET,
      sentNormalTx: true,
      sentNormalTxChainId: 1,
    });
    expect(mockedFetchContractInfo).not.toHaveBeenCalled();
  });

  it("only fetches contract source after bytecode exists", async () => {
    mockedGetCode.mockResolvedValue("0x60806040");
    mockEtherscanHistory();

    const result = okResult(await getContractInfoTool.execute({}, makeCtx()));

    expect(result).toMatchObject({
      kind: "contract",
      address: TARGET,
      verified: true,
      name: "KnownContract",
    });
    expect(mockedFetchContractInfo).toHaveBeenCalledWith(TARGET, 42161, "etherscan-key");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats EIP-7702 delegation code as EOA evidence, not as an unverified contract", async () => {
    mockedGetCode.mockResolvedValue("0xef01000000000000000000000000000000000000000002");
    mockEtherscanHistory({ outgoingChainId: 42161 });

    const result = okResult(await getContractInfoTool.execute({}, makeCtx()));

    expect(result).toMatchObject({
      kind: "eoa",
      address: TARGET,
      sentNormalTx: true,
      sentNormalTxChainId: 42161,
      delegationCode: "0xef01000000000000000000000000000000000000000002",
    });
    expect(mockedFetchContractInfo).not.toHaveBeenCalled();
  });
});
