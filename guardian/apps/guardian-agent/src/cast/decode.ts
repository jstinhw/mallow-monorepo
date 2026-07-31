import type { Hex } from "viem";
import { runCmd } from "./exec";

const SELECTOR_RE = /^0x[0-9a-fA-F]{8}$/;

export async function fourByteDecode(selector: Hex): Promise<string[] | undefined> {
  if (!SELECTOR_RE.test(selector)) throw new Error(`invalid selector ${selector}`);
  try {
    const out = await runCmd("cast", ["4byte-decode", selector]);
    const decoded = out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !s.toLowerCase().includes("not found"));
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export async function abiDecode(sig: string, data: Hex): Promise<unknown[]> {
  const out = await runCmd("cast", ["decode-calldata", sig, data]);
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
