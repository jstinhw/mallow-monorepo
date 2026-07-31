import { InteropExecutorContract } from '../blockchain/contracts/interop-executor.js';
import type { Order } from '@graviton/core';
import { createLogger } from '@graviton/core';
import { config } from '../config/index.js';
import {
  CCTP_ADAPTER,
  LAYERZERO_ADAPTER,
  LZ_DEFAULT_NATIVE_FEE,
} from '../constants/contracts.js';
import {
  retrieveAttestation,
  type CCTPAttestation,
  encodeCCTPReceiveMessage,
} from '../services/cctp.service.js';
import { getRelayerClient } from '../blockchain/client.js';
import { isAddressEqual, type Address, type Hash, type Hex } from 'viem';

const logger = createLogger('processor', config.log.level);

interface SourceTxResult {
  order: Order;
  chainId: number;
  txHash: Hash;
}

export class OrderProcessor {
  private contract: InteropExecutorContract;

  constructor() {
    this.contract = new InteropExecutorContract();
  }

  /**
   * Process an array of orders from the queue
   */
  async processOrders(orders: Order[]): Promise<void> {
    logger.info({ orderCount: orders.length }, 'Processing order batch');

    if (orders.length === 0) {
      logger.warn('Received empty order array');
      return;
    }

    try {
      // Step 1: Submit all source chain transactions in parallel
      const srcTxResults = await Promise.all(
        orders.map((order) => this.submitSourceTx(order))
      );

      logger.info(
        { orderCount: srcTxResults.length },
        'All source chain transactions submitted'
      );

      // Step 2: Group by adapter type and target chain, then process
      const lzOrders = srcTxResults.filter((result) =>
        isAddressEqual(result.order.srcIntent.adapter, LAYERZERO_ADAPTER)
      );

      if (lzOrders.length > 0) {
        logger.info(
          { count: lzOrders.length },
          'LayerZero orders completed (no target chain processing needed)'
        );
      }

      const cctpOrders = srcTxResults.filter((result) =>
        isAddressEqual(result.order.srcIntent.adapter, CCTP_ADAPTER)
      );

      if (cctpOrders.length > 0) {
        // Group CCTP orders by target chain
        const ordersByTargetChain = this.groupByTargetChain(cctpOrders);

        // Process each target chain group in parallel
        await Promise.all(
          Object.entries(ordersByTargetChain).map(
            ([targetChainId, txResults]) =>
              this.processCCTPBatch(txResults, Number(targetChainId))
          )
        );
      }

      logger.info(
        { orderCount: orders.length },
        'All orders processed successfully'
      );
    } catch (error) {
      logger.error(
        { error, orderCount: orders.length },
        'Failed to process orders'
      );
      throw error;
    }
  }

  /**
   * Submit a single order to the source chain
   */
  private async submitSourceTx(order: Order): Promise<SourceTxResult> {
    const srcChainId = Number(order.srcIntent.chainId);

    logger.info(
      {
        sender: order.sender,
        srcChainId,
        targetChainId: order.targetIntent.chainId.toString(),
        adapter: order.srcIntent.adapter,
      },
      'Submitting order to source chain'
    );

    const isLzOrder = isAddressEqual(
      order.srcIntent.adapter,
      LAYERZERO_ADAPTER
    );

    const preOpenCalls = isLzOrder
      ? [
          {
            to: LAYERZERO_ADAPTER as Address,
            data: '0x' as Hex,
            value: LZ_DEFAULT_NATIVE_FEE,
          },
        ]
      : undefined;

    const { hash, receipt } = await this.contract.open(order, preOpenCalls);

    if (receipt.status !== 'success') {
      throw new Error(`Transaction reverted: ${hash}`);
    }

    logger.info(
      { hash, blockNumber: receipt.blockNumber, srcChainId },
      'Order opened successfully on source chain'
    );

    return {
      order,
      chainId: srcChainId,
      txHash: hash,
    };
  }

  /**
   * Group transaction results by target chain ID
   */
  private groupByTargetChain(
    txResults: SourceTxResult[]
  ): Record<number, SourceTxResult[]> {
    return txResults.reduce(
      (acc, result) => {
        const targetChainId = Number(result.order.targetIntent.chainId);
        if (!acc[targetChainId]) {
          acc[targetChainId] = [];
        }
        acc[targetChainId].push(result);
        return acc;
      },
      {} as Record<number, SourceTxResult[]>
    );
  }

  /**
   * Process a batch of CCTP orders for a specific target chain
   */
  private async processCCTPBatch(
    txResults: SourceTxResult[],
    targetChainId: number
  ): Promise<void> {
    logger.info(
      { targetChainId, orderCount: txResults.length },
      'Processing CCTP batch for target chain'
    );

    // Retrieve all attestations in parallel
    const attestations = await Promise.all(
      txResults.map((result) =>
        retrieveAttestation(result.txHash, result.chainId)
      )
    );

    logger.info(
      { targetChainId, attestationCount: attestations.length },
      'Retrieved all CCTP attestations'
    );

    // Submit to target chain as a batch
    await this.submitCCTPBatchToTargetChain(attestations, targetChainId);
  }

  /**
   * Submit batched CCTP messages to target chain
   */
  private async submitCCTPBatchToTargetChain(
    attestations: CCTPAttestation[],
    targetChainId: number
  ): Promise<void> {
    const { kernelClient } = await getRelayerClient(
      targetChainId,
      config.blockchain.relayerPrivateKey as `0x${string}`
    );

    logger.info(
      { targetChainId, attestationCount: attestations.length },
      'Submitting CCTP batch to target chain'
    );

    const userOpHash = await kernelClient.sendUserOperation({
      calls: attestations.map((attestation) => ({
        to: CCTP_ADAPTER,
        data: encodeCCTPReceiveMessage(
          attestation.message,
          attestation.attestation
        ),
      })),
    });

    logger.info(
      { targetChainId, userOpHash },
      'CCTP batch submitted successfully on target chain'
    );

    const { receipt } = await kernelClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });

    if (receipt.status !== 'success') {
      throw new Error(`Target chain transaction reverted: ${userOpHash}`);
    }

    logger.info(
      {
        targetChainId,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
      },
      'CCTP batch submitted successfully on target chain'
    );
  }
}
