import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Address, Hex } from "viem";
import type {
  SimulationResult,
  BalanceChange,
  Erc20Transfer,
  Erc721Transfer,
  StorageDiff,
  TraceCall,
} from "../protocol";

export type AnvilHandle = {
  proc: ChildProcessWithoutNullStreams;
  port: number;
  url: string;
};

let warm: AnvilHandle | null = null;
let starting: Promise<AnvilHandle> | null = null;

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`anvil rpc ${method} failed: ${json.error.message}`);
  return json.result as T;
}

const ANVIL_START_TIMEOUT_MS = Number(process.env.ANVIL_START_TIMEOUT_MS ?? 60_000);

// If a simulation fails due to a stale fork (trie node errors), callers can clear the
// warm handle so the next request starts a fresh Anvil fork.
export function invalidateAnvil(): void {
  if (warm) {
    try {
      warm.proc.kill("SIGKILL");
    } catch {
      // Ignore: process may already be dead.
    }
    warm = null;
  }
}

export async function startAnvil(forkUrl: string): Promise<AnvilHandle> {
  if (warm) return warm;
  if (starting) return starting;
  starting = new Promise<AnvilHandle>((resolve, reject) => {
    if (!forkUrl) {
      starting = null;
      reject(new Error("startAnvil: forkUrl is empty (set ALCHEMY_API_KEY)"));
      return;
    }
    // Do NOT pass --silent: it suppresses the "Listening on …" line we parse for the random port.
    const proc = spawn("anvil", ["--fork-url", forkUrl, "--port", "0"]);
    let buf = "";
    let settled = false;
    const onData = (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (m && !settled) {
        settled = true;
        const port = Number(m[1]);
        const handle = { proc, port, url: `http://127.0.0.1:${port}` };
        proc.stdout.off("data", onData);
        warm = handle;
        starting = null;
        resolve(handle);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", (d) => {
      buf += d.toString();
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      starting = null;
      reject(err);
    });
    proc.on("exit", (code) => {
      if (settled) return;
      settled = true;
      starting = null;
      reject(
        new Error(
          `anvil exited (code=${code}) before becoming ready. Output:\n${buf.slice(0, 1200)}`,
        ),
      );
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      starting = null;
      proc.kill("SIGKILL");
      reject(
        new Error(
          `anvil did not start within ${ANVIL_START_TIMEOUT_MS}ms. ` +
            `Check that ALCHEMY_API_KEY points to a working Arbitrum RPC. Output:\n${buf.slice(0, 1200)}`,
        ),
      );
    }, ANVIL_START_TIMEOUT_MS);
  });
  return starting;
}

export async function shutdownAnvil(h?: AnvilHandle | null): Promise<void> {
  const target = h ?? warm;
  if (!target) return;
  warm = null;
  target.proc.kill("SIGKILL");
}

type SimTx = { from: Address; to: Address; value: bigint; data: Hex };

export async function simulateOnAnvil(h: AnvilHandle, tx: SimTx): Promise<SimulationResult> {
  const url = h.url;
  const snapshot = await rpc<Hex>(url, "evm_snapshot", []);
  try {
    await rpc(url, "anvil_impersonateAccount", [tx.from]);
    const required = (tx.value + 10n ** 17n).toString(16);
    await rpc(url, "anvil_setBalance", [tx.from, "0x" + required]);

    const traceCallParams = [
      {
        from: tx.from,
        to: tx.to,
        value: "0x" + tx.value.toString(16),
        data: tx.data,
      },
      "latest",
      { tracer: "callTracer", tracerConfig: { withLog: true } },
    ];
    const callTrace = await rpc<RawTraceCall>(url, "debug_traceCall", traceCallParams);

    const prestateParams = [
      {
        from: tx.from,
        to: tx.to,
        value: "0x" + tx.value.toString(16),
        data: tx.data,
      },
      "latest",
      { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
    ];
    const prestate = await rpc<PrestateDiff>(url, "debug_traceCall", prestateParams);

    const success = !callTrace.error;
    const result: SimulationResult = {
      success,
      revertReason: callTrace.error,
      gasUsed: callTrace.gasUsed ? BigInt(callTrace.gasUsed) : 0n,
      trace: normalizeTrace(callTrace),
      balanceChanges: extractBalanceChanges(prestate),
      erc20Transfers: extractErc20Transfers(callTrace),
      erc721Transfers: extractErc721Transfers(callTrace),
      storageDiffs: extractStorageDiffs(prestate),
    };
    return result;
  } finally {
    await rpc(url, "evm_revert", [snapshot]);
  }
}

type RawTraceCall = {
  type: TraceCall["type"];
  from: Address;
  to: Address;
  value?: Hex;
  input?: Hex;
  output?: Hex;
  gasUsed?: Hex;
  error?: string;
  calls?: RawTraceCall[];
  logs?: { address: Address; topics: Hex[]; data: Hex }[];
};

type PrestateAccount = {
  balance?: Hex;
  storage?: Record<Hex, Hex>;
};
type PrestateDiff = {
  pre: Record<Address, PrestateAccount>;
  post: Record<Address, PrestateAccount>;
};

function normalizeTrace(t: RawTraceCall): TraceCall {
  return {
    type: t.type,
    from: t.from,
    to: t.to,
    value: t.value ? BigInt(t.value) : undefined,
    input: t.input,
    output: t.output,
    gasUsed: t.gasUsed ? BigInt(t.gasUsed) : undefined,
    error: t.error,
    calls: t.calls?.map(normalizeTrace),
  };
}

function extractBalanceChanges(diff: PrestateDiff): BalanceChange[] {
  const out: BalanceChange[] = [];
  const addrs = new Set<Address>([
    ...(Object.keys(diff.pre ?? {}) as Address[]),
    ...(Object.keys(diff.post ?? {}) as Address[]),
  ]);
  for (const a of addrs) {
    const before = diff.pre?.[a]?.balance ? BigInt(diff.pre[a].balance!) : 0n;
    const after = diff.post?.[a]?.balance ? BigInt(diff.post[a].balance!) : before;
    if (before !== after) {
      out.push({ address: a, before, after, deltaWei: after - before });
    }
  }
  return out;
}

function* walkLogs(t: RawTraceCall): Generator<{ address: Address; topics: Hex[]; data: Hex }> {
  for (const log of t.logs ?? []) yield log;
  for (const c of t.calls ?? []) yield* walkLogs(c);
}

function extractErc20Transfers(t: RawTraceCall): Erc20Transfer[] {
  const out: Erc20Transfer[] = [];
  for (const log of walkLogs(t)) {
    if (
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics.length === 3 &&
      log.data &&
      log.data !== "0x"
    ) {
      out.push({
        token: log.address,
        from: ("0x" + log.topics[1].slice(26)) as Address,
        to: ("0x" + log.topics[2].slice(26)) as Address,
        amount: BigInt(log.data),
      });
    }
  }
  return out;
}

function extractErc721Transfers(t: RawTraceCall): Erc721Transfer[] {
  const out: Erc721Transfer[] = [];
  for (const log of walkLogs(t)) {
    if (log.topics[0] === TRANSFER_TOPIC && log.topics.length === 4) {
      out.push({
        token: log.address,
        from: ("0x" + log.topics[1].slice(26)) as Address,
        to: ("0x" + log.topics[2].slice(26)) as Address,
        tokenId: BigInt(log.topics[3]),
      });
    }
  }
  return out;
}

function extractStorageDiffs(diff: PrestateDiff): StorageDiff[] {
  const out: StorageDiff[] = [];
  for (const addr of Object.keys(diff.post ?? {}) as Address[]) {
    const post = diff.post[addr]?.storage ?? {};
    const pre = diff.pre?.[addr]?.storage ?? {};
    for (const slot of Object.keys(post) as Hex[]) {
      const before = (pre[slot] ?? "0x" + "0".repeat(64)) as Hex;
      const after = post[slot];
      if (before !== after) out.push({ address: addr, slot, before, after });
    }
  }
  return out;
}
