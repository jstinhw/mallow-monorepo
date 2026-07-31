import { beforeEach, describe, it, expect, vi } from "vitest";
import { fourByteDecode, abiDecode } from "./decode";
import { runCmd } from "./exec";

vi.mock("./exec", () => ({
  runCmd: vi.fn(async (_cmd: string, args: string[]) => {
    if (args[0] === "4byte-decode" && args[1] === "0xa9059cbb") {
      return "transfer(address,uint256)\n";
    }
    if (args[0] === "4byte-decode") {
      return "not found\n";
    }
    if (args[0] === "decode-calldata") {
      return "0xabababababababababababababababababababab\n1000\n";
    }
    throw new Error(`unexpected cast args: ${args.join(" ")}`);
  }),
}));

const mockedRunCmd = vi.mocked(runCmd);

describe("fourByteDecode", () => {
  beforeEach(() => {
    mockedRunCmd.mockClear();
  });

  it("resolves the canonical transfer selector", async () => {
    const sigs = await fourByteDecode("0xa9059cbb");
    expect(sigs).toContain("transfer(address,uint256)");
    expect(mockedRunCmd).toHaveBeenCalledWith("cast", ["4byte-decode", "0xa9059cbb"]);
  });

  it("returns undefined on unknown selector", async () => {
    const sigs = await fourByteDecode("0xabcdef12");
    expect(sigs).toBeUndefined();
  });

  it("rejects malformed selector", async () => {
    await expect(fourByteDecode("0xnope" as `0x${string}`)).rejects.toThrow(/selector/i);
  });
});

describe("abiDecode", () => {
  it("decodes transfer args", async () => {
    const data =
      "0xa9059cbb" +
      "000000000000000000000000abababababababababababababababababababab" +
      "00000000000000000000000000000000000000000000000000000000000003e8";
    const args = await abiDecode("transfer(address,uint256)", data as `0x${string}`);
    const addr = String(args[0]).toLowerCase();
    expect(addr).toBe("0xabababababababababababababababababababab");
    expect(BigInt(String(args[1]))).toBe(1000n);
  });
});
