import { toHex, type Address, type Hex, type PublicClient } from "viem";
import {
  accessListSchema,
  prestateDiffSchema,
  prestateFlatSchema,
  type AccessListResult,
  type PrestateDiff,
  type PrestateFlat,
} from "../schemas/rpc";

/**
 * Dynamic storage observation. Given a concrete call, discover which storage slots it writes (and,
 * where possible, reads) by simulating it at a pinned block. The tracer itself is deterministic;
 * this is the one place that asks the node "what would this call actually touch". Node support for
 * the richest methods varies, so it degrades through tiers and, worst case, observes nothing and
 * lets the static path (Phase 3+) supply anchors.
 */

export interface ObserveSeed {
  readonly from: Address;
  readonly to: Address;
  readonly calldata: Hex;
}

export interface SlotObservation {
  readonly address: Address;
  readonly slot: Hex;
  /** `write` = definitely changed; `touch` = read-or-write, indistinguishable at this tier. */
  readonly access: "write" | "touch";
  readonly pre?: Hex;
  readonly post?: Hex;
}

export type ObservationSource = "prestate-diff" | "access-list" | "static";

export interface StorageObservation {
  readonly source: ObservationSource;
  readonly slots: readonly SlotObservation[];
  /** The simulated call reverts at the pinned block — anchors, if any, are static hypotheses. */
  readonly reverted: boolean;
}

export interface StorageObserver {
  observe(seed: ObserveSeed, blockNumber: bigint): Promise<StorageObservation>;
}

const TRACE_TIMEOUT_MS = 10_000;

type RawRequest = (args: { method: string; params: readonly unknown[] }) => Promise<unknown>;

// ── pure derivations (exported for testing) ─────────────────────────────────────────────

/** Writes from a prestate diff: the union of pre/post storage keys per account, with values. */
export function writesFromPrestateDiff(diff: PrestateDiff): readonly SlotObservation[] {
  const out: SlotObservation[] = [];
  const addrs = new Set([...Object.keys(diff.pre ?? {}), ...Object.keys(diff.post ?? {})]);
  for (const address of addrs) {
    const pre = diff.pre?.[address]?.storage ?? {};
    const post = diff.post?.[address]?.storage ?? {};
    const slots = new Set([...Object.keys(pre), ...Object.keys(post)]);
    for (const slot of slots) {
      out.push({
        address: address as Address,
        slot: slot as Hex,
        access: "write",
        ...(pre[slot] !== undefined ? { pre: pre[slot] as Hex } : {}),
        ...(post[slot] !== undefined ? { post: post[slot] as Hex } : {}),
      });
    }
  }
  return out;
}

/** Touched (read-or-write) slots from a flat prestate, excluding those already known as writes. */
export function touchesFromPrestateFlat(
  flat: PrestateFlat,
  writeKeys: ReadonlySet<string>,
): readonly SlotObservation[] {
  const out: SlotObservation[] = [];
  for (const [address, account] of Object.entries(flat)) {
    for (const [slot, value] of Object.entries(account.storage ?? {})) {
      if (writeKeys.has(`${address.toLowerCase()}:${slot.toLowerCase()}`)) continue;
      out.push({
        address: address as Address,
        slot: slot as Hex,
        access: "touch",
        pre: value as Hex,
      });
    }
  }
  return out;
}

/** Touched slots from an access list (no read/write distinction available). */
export function touchesFromAccessList(result: AccessListResult): readonly SlotObservation[] {
  return result.accessList.flatMap((entry) =>
    entry.storageKeys.map((slot) => ({
      address: entry.address as Address,
      slot: slot as Hex,
      access: "touch" as const,
    })),
  );
}

const writeKey = (o: SlotObservation): string =>
  `${o.address.toLowerCase()}:${o.slot.toLowerCase()}`;

// ── observer ────────────────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`RPC call timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}

/** A JSON-RPC "method not found / unsupported" — the signal to stop trying a tier this session. */
function isMethodUnsupported(err: unknown): boolean {
  const e = err as { code?: number; message?: string; status?: number } | undefined;
  if (e?.code === -32601 || e?.status === 404 || e?.status === 405) return true;
  const msg = String(e?.message ?? "").toLowerCase();
  return /method not found|not supported|not available|does not exist|unsupported method/.test(msg);
}

/** Detects whether the simulated call reverts. Transport errors are swallowed (returns false). */
async function detectRevert(
  publicClient: PublicClient,
  seed: ObserveSeed,
  blockNumber: bigint,
): Promise<boolean> {
  try {
    await publicClient.call({ account: seed.from, to: seed.to, data: seed.calldata, blockNumber });
    return false;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    // viem raises these for on-chain reverts; anything else is a transport/other failure.
    return /Revert|CallExecution|ContractFunctionExecution/.test(name);
  }
}

export function createObserver(publicClient: PublicClient): StorageObserver {
  const request = publicClient.request as unknown as RawRequest;
  // Per-session capability memo: once a method is proven unsupported, skip it on later seeds.
  let debugSupported: boolean | undefined;
  let accessListSupported: boolean | undefined;

  async function tryPrestateDiff(
    seed: ObserveSeed,
    blockNumber: bigint,
  ): Promise<readonly SlotObservation[] | undefined> {
    if (debugSupported === false) return undefined;
    const callObj = { from: seed.from, to: seed.to, data: seed.calldata };
    try {
      const raw = await withTimeout(
        request({
          method: "debug_traceCall",
          params: [
            callObj,
            toHex(blockNumber),
            { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
          ],
        }),
        TRACE_TIMEOUT_MS,
      );
      debugSupported = true;
      const diff = prestateDiffSchema.parse(raw);
      const writes = writesFromPrestateDiff(diff);
      const reads = await tryPrestateReads(callObj, blockNumber, new Set(writes.map(writeKey)));
      return [...writes, ...reads];
    } catch (err) {
      if (isMethodUnsupported(err)) debugSupported = false;
      return undefined;
    }
  }

  /** Best-effort second (non-diff) trace to recover read-only touches; failure is non-fatal. */
  async function tryPrestateReads(
    callObj: object,
    blockNumber: bigint,
    writeKeys: ReadonlySet<string>,
  ): Promise<readonly SlotObservation[]> {
    try {
      const raw = await withTimeout(
        request({
          method: "debug_traceCall",
          params: [callObj, toHex(blockNumber), { tracer: "prestateTracer" }],
        }),
        TRACE_TIMEOUT_MS,
      );
      return touchesFromPrestateFlat(prestateFlatSchema.parse(raw), writeKeys);
    } catch {
      return [];
    }
  }

  async function tryAccessList(
    seed: ObserveSeed,
    blockNumber: bigint,
  ): Promise<readonly SlotObservation[] | undefined> {
    if (accessListSupported === false) return undefined;
    try {
      const raw = await withTimeout(
        request({
          method: "eth_createAccessList",
          params: [{ from: seed.from, to: seed.to, data: seed.calldata }, toHex(blockNumber)],
        }),
        TRACE_TIMEOUT_MS,
      );
      accessListSupported = true;
      return touchesFromAccessList(accessListSchema.parse(raw));
    } catch (err) {
      if (isMethodUnsupported(err)) accessListSupported = false;
      return undefined;
    }
  }

  return {
    async observe(seed, blockNumber) {
      const reverted = await detectRevert(publicClient, seed, blockNumber);

      const diff = await tryPrestateDiff(seed, blockNumber);
      if (diff) return { source: "prestate-diff", slots: diff, reverted };

      const accessList = await tryAccessList(seed, blockNumber);
      if (accessList) return { source: "access-list", slots: accessList, reverted };

      return { source: "static", slots: [], reverted };
    },
  };
}
