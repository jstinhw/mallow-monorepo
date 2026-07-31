import type { Address, Hex } from "viem";
import { runCmd } from "./exec";

export async function getCode(addr: Address, rpcUrl: string): Promise<Hex> {
  const out = await runCmd("cast", ["code", addr, "--rpc-url", rpcUrl]);
  const trimmed = out.trim();
  return trimmed as Hex;
}

export async function ethCall(
  args: { to: Address; data: Hex; from?: Address; value?: bigint },
  rpcUrl: string,
): Promise<Hex> {
  const argv = ["call", args.to, args.data, "--rpc-url", rpcUrl];
  if (args.from) argv.push("--from", args.from);
  if (args.value !== undefined) argv.push("--value", args.value.toString());
  const out = await runCmd("cast", argv);
  return out.trim() as Hex;
}
