import { describe, it, expect } from "vitest";
import { runCmd, CastError } from "./exec";

describe("runCmd", () => {
  it("returns stdout on success", async () => {
    const out = await runCmd("printf", ["hello"], { timeoutMs: 1000 });
    expect(out.trim()).toBe("hello");
  });

  it("throws CastError on non-zero exit", async () => {
    await expect(runCmd("sh", ["-c", "echo boom 1>&2; exit 7"])).rejects.toBeInstanceOf(CastError);
  });

  it("times out", async () => {
    await expect(runCmd("sh", ["-c", "sleep 5"], { timeoutMs: 50 })).rejects.toThrow(/timed out/);
  });

  it("rejects shell metacharacters by passing argv as array", async () => {
    const out = await runCmd("printf", ["%s", "; rm -rf /"], { timeoutMs: 1000 });
    expect(out).toBe("; rm -rf /");
  });
});
