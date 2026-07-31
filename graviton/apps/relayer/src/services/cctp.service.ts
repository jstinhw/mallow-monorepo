import { type Hash, type Hex, encodeFunctionData } from 'viem';
import axios from 'axios';
import { createLogger, getCCTPDomain, getCCTPUrl } from '@graviton/core';
import { config } from '../config/index.js';
import { MAX_ATTESTATION_RETRIES } from '../constants/contracts.js';
import { CCTP_ADAPTER_ABI } from '@graviton/core/abis';

const logger = createLogger('cctp-service', config.log.level);

export interface CCTPAttestation {
  attestation: `0x${string}`;
  message: `0x${string}`;
  eventNonce: string;
  status: string;
}

/**
 * Retrieve CCTP attestation for a transaction
 * Polls the Circle API until attestation is complete or max retries reached
 *
 * @param transactionHash - The source chain transaction hash
 * @param srcChainId - The source chain ID
 * @returns The complete CCTP attestation
 * @throws Error if attestation retrieval fails after max retries
 */
export async function retrieveAttestation(
  transactionHash: Hash,
  srcChainId: number
): Promise<CCTPAttestation> {
  logger.info({ srcChainId, transactionHash }, 'Retrieving CCTP attestation');

  const cctpUrl = getCCTPUrl(srcChainId);
  const srcDomain = getCCTPDomain(srcChainId);
  const url = `${cctpUrl}/messages/${srcDomain}?transactionHash=${transactionHash}`;

  let retryCount = 0;
  while (retryCount < MAX_ATTESTATION_RETRIES) {
    try {
      const response = await axios.get(url);

      if (response.status === 404) {
        logger.debug(
          { srcChainId, transactionHash, retryCount },
          'Attestation not yet available'
        );
      }

      if (response.data?.messages?.[0]?.status === 'complete') {
        logger.info(
          { srcChainId, transactionHash },
          'Attestation retrieved successfully'
        );
        return response.data.messages[0];
      }

      logger.debug(
        { srcChainId, transactionHash, retryCount },
        'Waiting for attestation to complete'
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      logger.warn(
        { error, srcChainId, transactionHash, retryCount },
        'Error fetching attestation'
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    retryCount++;
  }

  throw new Error(
    `Failed to retrieve attestation after ${MAX_ATTESTATION_RETRIES} retries`
  );
}

/**
 * Encode CCTP receiveMessage call data
 */
export function encodeCCTPReceiveMessage(message: Hex, attestation: Hex): Hex {
  return encodeFunctionData({
    abi: CCTP_ADAPTER_ABI,
    functionName: 'receiveMessage',
    args: [message, attestation],
  });
}
