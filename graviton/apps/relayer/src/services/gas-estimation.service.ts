import type { Address, StateOverride } from 'viem';
import type { Order } from '@graviton/core';
import { InteropExecutorContract } from '../blockchain/contracts/interop-executor.js';

export type JsonStateOverride = Array<{
  address: `0x${string}`;
  balance?: string;
  nonce?: number;
  code?: `0x${string}`;
  state?: Array<{ slot: `0x${string}`; value: `0x${string}` }>;
  stateDiff?: Array<{ slot: `0x${string}`; value: `0x${string}` }>;
}>;

export interface GasEstimationResult {
  gasUsed: bigint;
  gasCost: bigint;
  gasPrice: bigint;
}

/**
 * Service for handling gas estimation operations
 * Centralizes gas estimation logic for different transaction types
 */
export class GasEstimationService {
  constructor() {}

  /**
   * Estimate gas for opening an order on source chain
   */
  async estimateOpen(
    order: Order,
    interopExecutor: Address,
    jsonStateOverrides?: JsonStateOverride
  ): Promise<GasEstimationResult> {
    const srcChainId = Number(order.srcIntent.chainId);
    const contract = new InteropExecutorContract(srcChainId);

    const stateOverride = this.parseStateOverrides(jsonStateOverrides);
    const gasResult = await contract.estimateOpenGas(
      order,
      interopExecutor,
      stateOverride
    );

    return gasResult;
  }

  /**
   * Estimate gas for filling an order on target chain
   */
  async estimateFill(
    order: Order,
    token: Address,
    amount: bigint,
    jsonStateOverrides?: JsonStateOverride
  ): Promise<GasEstimationResult> {
    const targetChainId = Number(order.targetIntent.chainId);
    const contract = new InteropExecutorContract(targetChainId);

    const stateOverride = this.parseStateOverrides(jsonStateOverrides);
    const gasResult = await contract.estimateFillGas(
      order,
      token,
      amount,
      stateOverride
    );

    return gasResult;
  }

  /**
   * Parse JSON state overrides to viem StateOverride format
   */
  private parseStateOverrides(
    jsonStateOverrides?: JsonStateOverride
  ): StateOverride | undefined {
    if (!jsonStateOverrides) return undefined;

    return jsonStateOverrides.map((entry) => ({
      address: entry.address,
      balance: entry.balance ? BigInt(entry.balance) : undefined,
      nonce: entry.nonce,
      code: entry.code,
      ...(entry.state ? { state: entry.state } : {}),
      ...(entry.stateDiff ? { stateDiff: entry.stateDiff } : {}),
    })) as StateOverride;
  }
}

export const gasEstimationService = new GasEstimationService();
