import type { Address } from 'viem';
import { createLogger } from '@graviton/core';
import { config } from '../../config/index.js';

const logger = createLogger('across-quoter', config.log.level);

interface FeeBpsAndGas {
  bps: bigint;
  gas: bigint;
}

interface AcrossQuoteToken {
  decimals: number;
  symbol: string;
  address: Address;
  name: string;
  chainId: number;
}

interface AcrossFeeDetail {
  amount: string;
  pct: string;
  token: AcrossQuoteToken;
}

interface AcrossQuoteData {
  inputToken: AcrossQuoteToken;
  outputToken: AcrossQuoteToken;
  inputAmount: string;
  steps: {
    bridge: {
      inputAmount: string;
      outputAmount: string;
      tokenIn: AcrossQuoteToken;
      tokenOut: AcrossQuoteToken;
      fees: {
        amount: string;
        pct: string;
        token: AcrossQuoteToken;
        details: {
          type: string;
          relayerCapital: AcrossFeeDetail;
          destinationGas: AcrossFeeDetail;
          lp: AcrossFeeDetail;
        };
      };
    };
  };
}

export class AcrossQuoteFetcher {
  private readonly ACROSS_API_URL = 'https://app.across.to/api/suggested-fees';
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAY = 1000; // 1 second

  /**
   * Get a bridge quote from Across Protocol
   *
   * Across is a cross-chain bridge optimized for capital efficiency
   */
  async getBridgeQuote(
    sourceChainId: number,
    destinationChainId: number,
    inputToken: Address,
    outputToken: Address,
    amount: bigint,
    depositor: Address,
    recipient: Address
  ): Promise<FeeBpsAndGas> {
    logger.info(
      {
        sourceChainId,
        destinationChainId,
        inputToken,
        outputToken,
        amount: amount.toString(),
        depositor,
        recipient,
      },
      'Fetching Across bridge quote'
    );

    const queryParams = new URLSearchParams({
      tradeType: 'exactOutput',
      amount: amount.toString(),
      inputToken,
      outputToken,
      originChainId: sourceChainId.toString(),
      destinationChainId: destinationChainId.toString(),
      depositor,
      recipient,
    });

    let retries = 0;

    while (retries < this.MAX_RETRIES) {
      try {
        const response = await fetch(
          `${this.ACROSS_API_URL}?${queryParams.toString()}`
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = (await response.json()) as AcrossQuoteData;

        // Check for error status in response
        if ((data as any).status === 500) {
          retries++;
          logger.warn(
            { retries, maxRetries: this.MAX_RETRIES },
            'Received 500 status from Across API, retrying...'
          );
          await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY));
          continue;
        }

        const { details } = data.steps.bridge.fees;

        // Calculate total fee in basis points (lp fee + relayer capital fee)
        const bps = BigInt(details.lp.pct) + BigInt(details.relayerCapital.pct);

        // Destination gas fee
        const gas = BigInt(details.destinationGas.amount);

        logger.info(
          {
            bps: bps.toString(),
            gas: gas.toString(),
          },
          'Successfully fetched Across quote'
        );

        return { bps, gas };
      } catch (error) {
        retries++;
        logger.error(
          { error, retries, maxRetries: this.MAX_RETRIES },
          'Failed to fetch Across bridge quote, retrying...'
        );

        if (retries >= this.MAX_RETRIES) {
          throw new Error('Failed to get quote from Across after max retries');
        }

        await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY));
      }
    }

    throw new Error('Failed to get quote from Across');
  }
}
