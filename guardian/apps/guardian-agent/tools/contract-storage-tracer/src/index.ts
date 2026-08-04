import "dotenv/config";
import { parseSeed } from "./schemas/seed";
import { executeTrace } from "./engine/trace";
import { SUPPORTED_CHAINS } from "./chains";

interface CliArgs {
  readonly chainId: number;
  readonly from: string;
  readonly to: string;
  readonly calldata: string;
  readonly block?: number;
  readonly anchor?: string;
  readonly noLlm: boolean;
}

const USAGE =
  "usage: trace --chain <id> --from <addr> --to <addr> --calldata <0x..> [--block <n>] [--anchor <var>] [--no-llm]\n" +
  `  supported chains: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`;

function readFlag(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const from = readFlag(argv, "--from");
  const to = readFlag(argv, "--to");
  const calldata = readFlag(argv, "--calldata");
  if (!from || !to || !calldata) throw new Error(USAGE);
  const block = readFlag(argv, "--block");
  const anchor = readFlag(argv, "--anchor");
  return {
    chainId: Number(readFlag(argv, "--chain") ?? "1"),
    from,
    to,
    calldata,
    ...(block ? { block: Number(block) } : {}),
    ...(anchor ? { anchor } : {}),
    noLlm: argv.includes("--no-llm"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seed = parseSeed({
    chainId: args.chainId,
    from: args.from,
    to: args.to,
    calldata: args.calldata,
    block: args.block,
  });

  const report = await executeTrace(seed, {
    noLlm: args.noLlm,
    ...(args.anchor ? { anchorFilter: args.anchor } : {}),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
});
