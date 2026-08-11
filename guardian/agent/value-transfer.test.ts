import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import type { ContractInfo } from "../tools/contract-storage-tracer/src/acquire/contract";
import { createObserver, observeSeed } from "../tools/contract-storage-tracer/src/acquire/observe";
import type { TraceSession } from "../tools/contract-storage-tracer/src/engine/session";
import { untraceableReport } from "../tools/contract-storage-tracer/src/engine/untraceable";
import { seedSchema, weiOf } from "../tools/contract-storage-tracer/src/schemas/seed";
import { NO_CALLDATA, type TraceReport } from "../tools/contract-storage-tracer/src/types/report";
import { buildChecks, deterministicFindings, synthVerdict } from "./verdict";

const FROM = "0x28C6c06298d514Db089934071355E5743bf21d60";
const TO = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

/** A client that records what it was asked to simulate, so the call objects can be inspected. */
function recordingClient(): {
  readonly client: PublicClient;
  readonly calls: Record<string, unknown>[];
  readonly requests: { method: string; params: readonly unknown[] }[];
} {
  const calls: Record<string, unknown>[] = [];
  const requests: { method: string; params: readonly unknown[] }[] = [];
  const client = {
    call: async (args: Record<string, unknown>) => {
      calls.push(args);
      return { data: "0x" };
    },
    request: async (args: { method: string; params: readonly unknown[] }) => {
      requests.push(args);
      if (args.method === "debug_traceCall") return { pre: {}, post: {} };
      throw Object.assign(new Error("method not found"), { code: -32601 });
    },
  } as unknown as PublicClient;
  return { client, calls, requests };
}

const parse = (value?: string) =>
  seedSchema.parse({
    chainId: 1,
    from: FROM,
    to: TO,
    data: "0x",
    ...(value === undefined ? {} : { value }),
  });

describe("value threading", () => {
  it("carries value into the simulated call objects", async () => {
    const { client, calls, requests } = recordingClient();
    // 0.01 ETH — the amount is what a wrong trace would silently change.
    await createObserver(client).observe(observeSeed(parse("10000000000000000")), 100n);

    expect(calls[0]).toMatchObject({ value: 10_000_000_000_000_000n });
    expect(requests[0]?.params[0]).toMatchObject({ value: "0x2386f26fc10000" });
  });

  it("omits value entirely when the call is not payable", async () => {
    const { client, calls, requests } = recordingClient();
    await createObserver(client).observe(observeSeed(parse()), 100n);

    expect(calls[0]).not.toHaveProperty("value");
    expect(requests[0]?.params[0]).not.toHaveProperty("value");
  });

  it("reads value as hex or decimal, the way wallets emit it", () => {
    expect(weiOf(parse("0x2386f26fc10000").value)).toBe(10_000_000_000_000_000n);
    expect(weiOf(parse("10000000000000000").value)).toBe(10_000_000_000_000_000n);
    expect(weiOf(parse().value)).toBe(0n);
    expect(() => parse("1.5")).toThrow();
    expect(() => parse("-1")).toThrow();
  });
});

const transferTrace = {
  seedSummary: "",
  block: 1,
  decoded: { selector: NO_CALLDATA, functionName: "(value transfer)", source: "unknown", args: [] },
  observation: { source: "static", reverted: false, unattributed: [] },
  anchors: [],
  compressedContracts: [],
  chains: [],
  unbounded: [],
  addresses: [{ address: TO, classification: "eoa" }],
  coverage: { kind: "partial", reasons: ["no verified source at the target"] },
  graph: { anchors: [], nodes: [], edges: [] },
} as unknown as TraceReport;

const withAddresses = (addresses: unknown[]): TraceReport =>
  ({ ...transferTrace, addresses }) as unknown as TraceReport;

describe("plain value transfer verdict", () => {
  it("does not flag absent calldata as undecodable", () => {
    // Otherwise every ETH send draws a medium finding and tells the user to review a bare transfer.
    expect(deterministicFindings(transferTrace).map((f) => f.id)).not.toContain(
      "calldata-undecoded",
    );
    expect(buildChecks(transferTrace).find((c) => c.kind === "decode")?.ok).toBe(true);
  });

  it("still flags an opaque selector when there is calldata", () => {
    const opaque = {
      ...transferTrace,
      decoded: { selector: "0x12345678", functionName: "unknown", source: "unknown", args: [] },
    } as unknown as TraceReport;

    expect(deterministicFindings(opaque).map((f) => f.id)).toContain("calldata-undecoded");
  });

  it("flags a recipient with no code and no history", () => {
    const findings = deterministicFindings(
      withAddresses([{ address: TO, classification: "undetermined" }]),
    );

    expect(findings.find((f) => f.id === "undetermined-counterparty")?.severity).toBe("medium");
  });

  it("flags an EIP-7702 delegated recipient", () => {
    const findings = deterministicFindings(
      withAddresses([{ address: TO, classification: "eoa", delegation: FROM }]),
    );

    expect(findings.find((f) => f.id === "delegated-eoa-counterparty")?.severity).toBe("low");
  });
});

describe("untraceable target", () => {
  const session = (kind: "eoa" | "undetermined") =>
    ({
      chainId: 42161,
      blockNumber: 100n,
      log: { step: () => {}, sub: () => {}, note: () => {}, tree: () => {} },
      contracts: async () => ({
        kind,
        address: TO,
        enrichment: { nonce: kind === "eoa" ? 12 : 0, sentTxs: kind === "eoa", tags: { labels: [] } },
      }),
      observer: { observe: async () => ({ source: "static", slots: [], reverted: false }) },
    }) as unknown as TraceSession;

  it("reports a plain ETH transfer instead of throwing", async () => {
    const report = await untraceableReport(session("eoa"), parse("10000000000000000"), {
      kind: "eoa",
      address: TO,
      enrichment: { nonce: 12, sentTxs: true, tags: { labels: [] } },
    } as unknown as ContractInfo);

    expect(report.decoded.selector).toBe(NO_CALLDATA);
    expect(report.anchors).toEqual([]);
    expect(report.coverage.kind).toBe("partial");
    expect(report.seedSummary).toContain("0.01 ETH");
    expect(report.addresses[0]).toMatchObject({ address: TO, classification: "eoa" });

    // The whole point: it produces a signable verdict, not an error.
    const verdict = synthVerdict({
      trace: report,
      findings: deterministicFindings(report),
      llm: null,
      durationMs: 1,
      roundsUsed: 0,
    });
    expect(verdict.decision).toBe("sign");
  });

  it("tells the user to review a transfer to an address with no history", async () => {
    const report = await untraceableReport(session("undetermined"), parse("10000000000000000"), {
      kind: "undetermined",
      address: TO,
      enrichment: { nonce: 0, sentTxs: false, tags: { labels: [] } },
    } as unknown as ContractInfo);

    const verdict = synthVerdict({
      trace: report,
      findings: deterministicFindings(report),
      llm: null,
      durationMs: 1,
      roundsUsed: 0,
    });
    expect(verdict.decision).toBe("review");
  });
});
