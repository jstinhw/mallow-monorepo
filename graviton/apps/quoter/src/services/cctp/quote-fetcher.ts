import { encodeFunctionData, pad, parseUnits, type Address } from 'viem';
import { Call, createLogger } from '@graviton/core';
import type { BridgeFeeResult } from '../../types/quote.types.js';
import { config } from '../../config/index.js';

const logger = createLogger('cctp-quoter', config.log.level);

export interface FeeBpsAndGas {
  bps: bigint;
  gas: bigint;
}

/**
 * CCTP Quote Data response from Circle API
 */
type CCTPQuoteData = {
  finalityThreshold: number;
  minimumFee: number;
}[];

/**
 * Circle CCTP domain mappings
 * See: https://developers.circle.com/stablecoins/docs/cctp-technical-reference
 */
const CCTP_DOMAINS: Record<number, number> = {
  10: 2, // Optimism
  42161: 3, // Arbitrum One
  8453: 6, // Base
  11155111: 0, // Sepolia
  84532: 6, // Base Sepolia
};

export const CCTP_TOKEN_MESSAGER_ADDRESS: Address =
  '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';

export const CCTP_THRESHOLD = 1000;

export const CCTP_DESTINATION_CALLER = pad('0x', { size: 32 });

/**
 * Testnet chain IDs
 */
const TESTNET_CHAIN_IDS = [11155111, 84532] as const;

/**
 * CCTP API URLs
 */
const CCTP_MAINNET_URL = 'https://iris-api.circle.com/v2';
const CCTP_TESTNET_URL = 'https://iris-api-sandbox.circle.com/v2';

export class CCTPQuoteFetcher {
  /**
   * Check if a chain is a testnet
   */
  private isTestnetChainId(chainId: number): boolean {
    return (TESTNET_CHAIN_IDS as readonly number[]).includes(chainId);
  }

  /**
   * Get CCTP API URL based on chain ID
   */
  private getCCTPUrl(chainId: number): string {
    return this.isTestnetChainId(chainId) ? CCTP_TESTNET_URL : CCTP_MAINNET_URL;
  }

  /**
   * Get CCTP domain for a chain
   */
  private getCCTPDomain(chainId: number): number {
    const domain = CCTP_DOMAINS[chainId];
    if (domain === undefined) {
      throw new Error(`chainId: ${chainId} not supported for CCTP`);
    }
    return domain;
  }

  /**
   * Get a bridge quote from Circle CCTP
   *
   * CCTP is a permissionless on-chain protocol for USDC bridging
   */
  async getBridgeQuote(
    sourceChainId: number,
    destinationChainId: number,
    token: Address,
    amount: bigint,
    recipient?: Address
  ): Promise<BridgeFeeResult> {
    logger.info(
      {
        sourceChainId,
        destinationChainId,
        token,
        amount: amount.toString(),
      },
      'Fetching CCTP bridge quote'
    );

    try {
      const srcDomain = this.getCCTPDomain(sourceChainId);
      const targetDomain = this.getCCTPDomain(destinationChainId);
      const cctpUrl = this.getCCTPUrl(sourceChainId);

      const response = await fetch(
        `${cctpUrl}/burn/USDC/fees/${srcDomain}/${targetDomain}`
      );

      if (!response.ok) {
        throw new Error(`Failed to get CCTP quote: ${response.statusText}`);
      }

      const data = (await response.json()) as CCTPQuoteData;

      // Sort by finality threshold and get the minimum fee
      const bps =
        data.sort((a, b) =>
          a.finalityThreshold > b.finalityThreshold ? 1 : -1
        )[0]?.minimumFee ?? 0;

      // Convert bps to the correct format (multiply by 10^14)
      const bpsInBigInt = parseUnits(bps.toString(), 14);

      let calls: Call[] = [];
      if (recipient) {
        calls = [
          {
            to: CCTP_TOKEN_MESSAGER_ADDRESS,
            data: encodeFunctionData({
              abi: [
                {
                  type: 'function',
                  name: 'depositForBurn',
                  stateMutability: 'nonpayable',
                  inputs: [
                    { name: 'amount', type: 'uint256' },
                    { name: 'destinationDomain', type: 'uint32' },
                    { name: 'mintRecipient', type: 'bytes32' },
                    { name: 'burnToken', type: 'address' },
                    { name: 'destinationCaller', type: 'bytes32' },
                    { name: 'maxFee', type: 'uint256' },
                    { name: 'minFinalityThreshold', type: 'uint32' },
                  ],
                  outputs: [],
                },
              ],
              functionName: 'depositForBurn',
              args: [
                amount,
                targetDomain,
                pad(recipient, { size: 32 }),
                token,
                CCTP_DESTINATION_CALLER,
                bpsInBigInt,
                CCTP_THRESHOLD,
              ],
            }),
            value: 0n,
          },
        ];
      }

      logger.info(
        {
          bps: bpsInBigInt.toString(),
          gas: '0',
        },
        'Successfully fetched CCTP quote'
      );

      return {
        fee: {
          bps: bpsInBigInt,
          gas: 0n,
        },
        calls,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch CCTP bridge quote');
      throw error;
    }
  }

  /**
   * Check if a chain is supported by CCTP
   */
  isSupportedChain(chainId: number): boolean {
    return chainId in CCTP_DOMAINS;
  }
}
