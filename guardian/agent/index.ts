import "dotenv/config";
import { readFileSync } from "node:fs";
import { analyzeTransactionRequest } from "./agent";
import { formatVerdictReport, writeAgentOutputs } from "./output";

const USAGE =
  "usage: npm run trace -- --chain <id> --from <addr> --to <addr> --data <0x..> [--block <n>] [--anchor <var>] [--no-llm] [--out-dir out]\n" +
  "   or: npm run trace -- --request request.json";

function readFlag(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function requestFromArgs(argv: readonly string[]): unknown {
  const requestPath = readFlag(argv, "--request");
  if (requestPath) return JSON.parse(readFileSync(requestPath, "utf8"));

  const from = readFlag(argv, "--from");
  const to = readFlag(argv, "--to");
  const data = readFlag(argv, "--data");
  if (!from || !to || !data) throw new Error(USAGE);

  const block = readFlag(argv, "--block");
  const anchor = readFlag(argv, "--anchor");
  return {
    chainId: Number(readFlag(argv, "--chain") ?? "1"),
    from,
    to,
    data,
    ...(block ? { block: Number(block) } : {}),
    ...(anchor ? { anchor } : {}),
    noLlm: argv.includes("--no-llm"),
  };
}

/** Streams progress + live LLM tokens to stderr so stdout stays clean for the verdict. */
function makeCliHooks(): {
  onProgress: (line: string) => void;
  onDelta: (d: { channel: string; text: string }) => void;
} {
  let channel: string | null = null;
  const endStream = (): void => {
    if (channel !== null) process.stderr.write("\n");
    channel = null;
  };
  return {
    onProgress(line) {
      endStream();
      process.stderr.write(line.startsWith("[trace]") ? `${line}\n` : `[agent] ${line}\n`);
    },
    onDelta(d) {
      if (d.channel !== channel) {
        endStream();
        process.stderr.write(`[llm ${d.channel}] `);
        channel = d.channel;
      }
      process.stderr.write(d.text);
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const report = await analyzeTransactionRequest(requestFromArgs(argv), makeCliHooks());
  const paths = writeAgentOutputs(report, readFlag(argv, "--out-dir") ?? "out");
  process.stdout.write(
    `${formatVerdictReport(report)}\nwrote:\n${paths.map((p) => `  ${p}`).join("\n")}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
