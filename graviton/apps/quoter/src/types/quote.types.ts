import type { Call } from 'viem';

/**
 * Response from the bridge quote endpoint
 */
export interface BridgeFeeResult {
  fee: {
    bps: bigint;
    gas: bigint;
  };
  calls: Call[];
}
