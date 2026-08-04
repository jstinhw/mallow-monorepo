import type { PublicClient } from "viem";
import type { ContractLoader } from "../acquire/contract-cache";
import type { StorageObserver } from "../acquire/observe";
import type { Bounds } from "../config";
import type { LlmService } from "../llm/registry";
import type { StepLogger } from "../log";

/**
 * Read-only handles shared by every trace phase: the viem public client, the pinned block, the
 * memoized contract loader, the dynamic storage observer, the recursion bounds, and the step
 * logger. Built once per run by `executeTrace`.
 */
export interface TraceSession {
  readonly chainId: number;
  readonly publicClient: PublicClient;
  /** Every state read in the run is pinned to this block for reproducibility. */
  readonly blockNumber: bigint;
  readonly contracts: ContractLoader;
  readonly observer: StorageObserver;
  readonly bounds: Bounds;
  /** Optional advisory model service; absent ⇒ a fully deterministic run. */
  readonly llm?: LlmService;
  readonly log: StepLogger;
}
