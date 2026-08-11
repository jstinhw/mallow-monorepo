import { formatEther, type Hex } from "viem";
import type { ContractInfo } from "../acquire/contract";
import { decodeSeedCall } from "../acquire/decode";
import { observeSeed } from "../acquire/observe";
import { weiOf, type Seed } from "../schemas/seed";
import { NO_CALLDATA, type DecodedSummary, type TraceReport } from "../types/report";
import { toAddressReport, toDecodedSummary } from "./report-mappers";
import type { TraceSession } from "./session";

/**
 * The report for a seed whose target has no verified source. Attributing a storage slot to a
 * variable needs a layout, and without one there are no anchors — so the whole anchor→touchers→
 * callers pipeline has nothing to run on.
 *
 * That is a fact about the target, not a failure. A plain ETH transfer to an EOA is the most
 * common transaction a wallet signs, and answering it with an error would push the caller to
 * sign unreviewed — the opposite of the point. So this states what *is* knowable (recipient
 * classification and tags, whether the call reverts, which slots were touched but couldn't be
 * explained) and records the gap in `coverage.reasons` rather than pretending to completeness.
 */
export async function untraceableReport(
  session: TraceSession,
  seed: Seed,
  target: ContractInfo,
): Promise<TraceReport> {
  const { log } = session;
  const wei = weiOf(seed.value);
  const block = Number(session.blockNumber);

  log.step(`target ${seed.to} is ${target.kind} · no verified layout — reporting without a trace`);

  // No calldata means no selector, so the decoder (which slices 4 bytes) is skipped entirely.
  const decoded: DecodedSummary =
    seed.data === NO_CALLDATA
      ? { selector: NO_CALLDATA, functionName: "(value transfer)", source: "unknown", args: [] }
      : toDecodedSummary(await decodeSeedCall(seed.data as Hex, undefined, log));

  log.step("observe storage · simulate at pinned block");
  const observation = await session.observer.observe(observeSeed(seed), session.blockNumber);
  log.sub(
    `source ${observation.source}${observation.reverted ? " · call reverts" : ""} · ` +
      `${observation.slots.length} slots touched, none attributable`,
  );

  const address = toAddressReport(target);
  log.sub(
    `recipient ${address.address} · ${address.classification}` +
      `${address.ens ? ` (${address.ens})` : ""}${address.note ? ` · ${address.note}` : ""}`,
  );

  const reasons = [
    `target ${seed.to} is ${target.kind}; storage attribution needs verified source, so no ` +
      `anchors were resolved and no caller reach was explored`,
  ];
  if (observation.reverted) reasons.push("the seed call reverts at the pinned block");

  const amount = wei > 0n ? `${formatEther(wei)} ETH` : "no value";
  return {
    seedSummary:
      `${decoded.functionName} → ${seed.to} (${target.kind}) from ${seed.from} @ block ${block} ` +
      `— ${amount}; no verified source at the target, nothing to trace`,
    block,
    decoded,
    observation: {
      source: observation.source,
      reverted: observation.reverted,
      // Every touched slot is unattributed here, by definition: there is no layout to match against.
      unattributed: observation.slots.map((o) => ({
        slot: o.slot,
        ...(o.pre ? { pre: o.pre } : {}),
        ...(o.post ? { post: o.post } : {}),
      })),
    },
    anchors: [],
    compressedContracts: [],
    chains: [],
    unbounded: [],
    addresses: [address],
    coverage: { kind: "partial", reasons },
    graph: { anchors: [], nodes: [], edges: [] },
  };
}
