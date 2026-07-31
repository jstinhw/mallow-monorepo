import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./exec", () => ({
  runCmd: vi.fn(),
  CastError: class extends Error {},
}));

import { runCmd } from "./exec";
import { getCode, ethCall } from "./call";

const mocked = runCmd as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mocked.mockReset());

describe("getCode", () => {
  it("returns 0x for EOA", async () => {
    mocked.mockResolvedValueOnce("0x\n");
    const code = await getCode("0x0000000000000000000000000000000000000001", "https://rpc");
    expect(code).toBe("0x");
  });

  it("returns bytecode for a contract", async () => {
    mocked.mockResolvedValueOnce("0x6080604052\n");
    const code = await getCode("0x00000000000000000000000000000000000000aa", "https://rpc");
    expect(code.startsWith("0x6080")).toBe(true);
  });
});

describe("ethCall", () => {
  it("forwards args correctly", async () => {
    mocked.mockResolvedValueOnce("0x01\n");
    const out = await ethCall(
      { to: "0x00000000000000000000000000000000000000aa", data: "0x" },
      "https://rpc",
    );
    expect(out).toBe("0x01");
    expect(mocked).toHaveBeenCalledWith(
      "cast",
      expect.arrayContaining(["call", "--rpc-url", "https://rpc"]),
    );
  });
});
