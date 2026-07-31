import { config } from '../../config/index.js';
import type { Address } from 'viem';
import type {
  Order,
  StateOverrideEntry,
  GasEstimateResponse,
} from '@graviton/core';

export type JsonStateOverride = StateOverrideEntry[];

export interface OpenGasEstimateRequest {
  operation: 'open';
  order: Order;
  interopExecutor: Address;
  stateOverrides?: JsonStateOverride;
}

export interface FillGasEstimateRequest {
  operation: 'fill';
  order: Order;
  interopExecutor: Address;
  token: string;
  amount: string;
  stateOverrides?: JsonStateOverride;
}

export type GasEstimateRequest =
  OpenGasEstimateRequest | FillGasEstimateRequest;

export type { GasEstimateResponse };

import { RelayerServiceError } from '../../errors/index.js';
export { RelayerServiceError };

export class RelayerClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.services.relayerUrl;
  }

  async estimateGas(params: GasEstimateRequest): Promise<GasEstimateResponse> {
    const url = new URL('/v1/gas', this.baseUrl);
    const chainId =
      params.operation === 'open'
        ? params.order.srcIntent.chainId
        : params.order.targetIntent.chainId;

    let response;
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });
    } catch (error) {
      throw new RelayerServiceError(
        `Failed to connect to relayer service at ${this.baseUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        { chainId, operation: params.operation }
      );
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: response.statusText,
      }));

      const errorMessage =
        errorData.error || errorData.message || response.statusText;
      const details = errorData.details || errorData;

      throw new RelayerServiceError(
        `Gas estimation failed for ${params.operation} operation on chain ${chainId}: ${errorMessage}`,
        response.status,
        details
      );
    }

    return await response.json();
  }
}

export const relayerClient = new RelayerClient();
