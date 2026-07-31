import { serializeBigInt, type Order } from '@graviton/core';
import {
  relayerClient,
  type JsonStateOverride,
} from './clients/relayer.client.js';
import { INTEROP_EXECUTOR } from '../constants/contracts.js';

interface FeeData {
  protocolFee: {
    gas: bigint;
    bps: bigint;
  };
  srcGas: bigint;
}

/**
 * Service for calculating fees for cross-chain orders
 */
export class FeeService {
  /**
   * Get fee data for an order
   * @param order - The order to calculate fees for
   * @param stateOverrides - Optional state overrides for gas estimation
   */
  async getFeeData(
    order: Order,
    stateOverrides?: JsonStateOverride
  ): Promise<FeeData> {
    // Get actual gas estimate from relayer service
    const gasEstimate = await relayerClient.estimateGas({
      operation: 'open',
      order: serializeBigInt(order),
      interopExecutor: INTEROP_EXECUTOR,
      stateOverrides,
    });

    return {
      protocolFee: {
        gas: 0n,
        bps: 0n, // Protocol fee set to 0 for now
      },
      srcGas: BigInt(gasEstimate.gasUsed),
    };
  }
}

export const feeService = new FeeService();
