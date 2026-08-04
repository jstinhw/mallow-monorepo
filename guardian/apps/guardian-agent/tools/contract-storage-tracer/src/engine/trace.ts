import { createPublicClient, http } from "viem";
import type { Seed } from "../schemas/seed";
import type { TraceReport } from "../types/report";
import { createContractLoader } from "../acquire/contract-cache";
import { createObserver } from "../acquire/observe";
import { createTagger } from "../acquire/tagging";
import { getSupportedChain } from "../chains";
import { loadConfig } from "../config";
import { loadLlmService } from "../llm/registry";
import { createStepLogger, type StepLogger } from "../log";
import { applyAdvisory } from "./advise";
import { assembleReport } from "./assemble-report";
import { classifyTouchers } from "./classify-touchers";
import { recurseCallers } from "./recurse-callers";
import { resolveSeed } from "./resolve-seed";
import type { TraceSession } from "./session";

export interface TraceOptions {
  /** Restrict the trace to a single written variable by name. */
  readonly anchorFilter?: string;
  /** Force a deterministic run, skipping the advisory LLM layer even if configured. */
  readonly noLlm?: boolean;
}

/**
 * Executes a storage-anchored trace for an arbitrary seed call: decodes the calldata, observes the
 * storage it writes, attributes each written slot to a layout variable, then for every anchor finds
 * the functions that can touch it (with boundedness) and recurses backward over the authorized
 * callers — stopping at EOAs, descending into contracts. Unbounded frontiers are reported, never
 * silently expanded. `approve` is one instance of this general path.
 *
 * Each phase is a module with an explicit data contract:
 *   resolve-seed (seed → concrete, chain-verified anchors)
 *     → classify-touchers (per-anchor token-side boundedness + frontier)
 *     → recurse-callers (shared backward worklist over all frontiers)
 *     → advise (optional, advisory-only LLM annotations)
 *     → assemble-report (merge + coverage + address book).
 */
export async function executeTrace(
  seed: Seed,
  options: TraceOptions = {},
  log?: StepLogger,
): Promise<TraceReport> {
  const config = loadConfig();
  const logger = log ?? createStepLogger(config.traceLog);
  const { chain, rpcUrl } = getSupportedChain(seed.chainId);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const blockNumber =
    seed.block === undefined ? await publicClient.getBlockNumber() : BigInt(seed.block);
  logger.step(`connect chain ${seed.chainId} · pinned block ${Number(blockNumber)}`);

  const llm = options.noLlm || !config.llm ? undefined : loadLlmService(config.llm);
  const tagger = createTagger(publicClient, config.tagServiceUrl);
  const session: TraceSession = {
    chainId: seed.chainId,
    publicClient,
    blockNumber,
    contracts: createContractLoader(publicClient, blockNumber, seed.chainId, tagger),
    observer: createObserver(publicClient),
    bounds: config.bounds,
    ...(llm ? { llm } : {}),
    log: logger,
  };

  const resolved = await resolveSeed(session, seed, options);
  const tokenSides = resolved.anchors.map((ai, i) =>
    classifyTouchers(session, resolved.target, ai, i),
  );
  const frontier = tokenSides.flatMap((t) => t.frontier);
  const recursion = await recurseCallers(session, resolved.target, resolved.anchors, frontier);
  const advisory = await applyAdvisory(session, resolved, recursion);
  return assembleReport(session, seed, resolved, tokenSides, recursion, advisory);
}
