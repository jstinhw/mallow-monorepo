import { serializeBigInt } from '@graviton/core';
import type {
  SwapRouteRequest,
  SwapRouteResponse,
  MultiInputQuoteRequest,
  MultiInputQuoteResponse,
} from '@graviton/core';
import { config } from '../../config/index.js';
import { QuoterServiceError } from '../../errors/index.js';

export class QuoterClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.services.quoterUrl;
  }

  async getQuoteMultiInput(
    params: MultiInputQuoteRequest
  ): Promise<MultiInputQuoteResponse> {
    const url = new URL('/v1/quote/multi-input', this.baseUrl);

    const body: Record<string, unknown> = serializeBigInt({
      depositor: params.depositor,
      recipient: params.recipient,
      originChainId: params.originChainId,
      destinationChainId: params.destinationChainId,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      bridgeType: params.bridgeType,
    });

    if (params.slippage !== undefined) {
      body.slippage = params.slippage;
    }

    if (params.calls) {
      body.calls = params.calls;
    }

    if (params.message) {
      body.message = params.message;
    }

    if (params.refundRecipient) {
      body.refundRecipient = params.refundRecipient;
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new QuoterServiceError(
        `Multi-input quote failed (${response.status}): ${body}`,
        response.status,
        body
      );
    }

    return await response.json();
  }

  async getSwapRoute(params: SwapRouteRequest): Promise<SwapRouteResponse> {
    const url = new URL('/v1/quote/route', this.baseUrl);

    const body: Record<string, unknown> = serializeBigInt({
      inputTokens: params.inputTokens,
      originChainId: params.originChainId,
      outputTokens: params.outputTokens,
      destinationChainId: params.destinationChainId,
      bridgeType: params.bridgeType,
    });

    if (params.depositor) {
      body.depositor = params.depositor;
    }

    if (params.recipient) {
      body.recipient = params.recipient;
    }

    if (params.slippage !== undefined) {
      body.slippage = params.slippage;
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new QuoterServiceError(
        `Swap route failed (${response.status}): ${body}`,
        response.status,
        body
      );
    }

    return await response.json();
  }
}

export const quoterClient = new QuoterClient();
