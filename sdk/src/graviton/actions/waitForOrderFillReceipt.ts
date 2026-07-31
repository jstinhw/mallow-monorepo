import type { Address, Hash } from 'viem';
import { stringify } from 'viem/utils';
import type { InteropClient } from '../clients/types.js';
import { INTEROP_EXECUTOR } from '../constants/index.js';
import { WaitForOrderFillReceiptTimeoutError } from '../utils/errors.js';
import { observe } from '../utils/observe.js';
import { poll } from '../utils/poll.js';

/**
 * Parameters for waiting for order fill receipt
 */
export type WaitForOrderFillReceiptParameters = {
  /** The hash of the order to track */
  orderHash: Hash;
  /** The chain ID where the order fills (target chain) */
  chainId: number;
  /** The interop executor contract address */
  interopExecutor?: Address;
  /**
   * Polling frequency in milliseconds
   * @default 500
   */
  pollingInterval?: number;
  /**
   * Number of retry attempts
   * @default 120
   */
  retryCount?: number;
  /**
   * Timeout in milliseconds
   * @default 60000 (1 minutes)
   */
  timeout?: number;
};

/**
 * Return type for waitForOrderFillReceipt
 */
export type WaitForOrderFillReceiptReturnType = {
  event: {
    orderHash: Hash;
    sender: Address;
    srcChainId: bigint;
  };
  transaction: {
    hash: Hash;
    blockNumber: bigint;
    blockHash: Hash;
    from: Address;
    to: Address;
    status: string;
    gasUsed: bigint;
  };
};

/**
 * Waits for an order to be filled on the target chain.
 *
 * This action polls the Graviton API until the order is filled or times out.
 * An order being "filled" means the target chain transaction has been confirmed
 * and the requested tokens/executions have been delivered to the recipient.
 *
 * @param client - The Interop Client
 * @param parameters - Order tracking parameters
 * @returns Receipt information for the filled order
 *
 * @throws {WaitForOrderFillReceiptTimeoutError} If polling times out
 *
 * @example
 * ```typescript
 * const { orderHashes } = await client.sendOrders({ orders });
 *
 * // Wait for order to open first
 * await client.waitForOrderOpenReceipt({
 *   orderHash: orderHashes[0].orderHash,
 *   chainId: Number(orderHashes[0].chainId),
 *   interopExecutor: INTEROP_EXECUTOR,
 * });
 *
 * // Then wait for order to fill
 * const fillReceipt = await client.waitForOrderFillReceipt({
 *   orderHash: orderHashes[0].orderHash,
 *   chainId: targetChainId,
 *   interopExecutor: INTEROP_EXECUTOR,
 * });
 *
 * console.log('Order completed:', fillReceipt);
 * ```
 */
export async function waitForOrderFillReceipt(
  client: InteropClient,
  parameters: WaitForOrderFillReceiptParameters,
): Promise<WaitForOrderFillReceiptReturnType> {
  const {
    orderHash,
    chainId,
    interopExecutor = INTEROP_EXECUTOR,
    pollingInterval = 500,
    retryCount = 120,
    timeout = 60_000,
  } = parameters;

  let count = 0;
  const observerId = stringify(['waitForOrderFillReceipt', orderHash, chainId, interopExecutor]);

  return new Promise((resolve, reject) => {
    const unobserve = observe(observerId, { resolve, reject }, (emit) => {
      const done = (fn: () => void) => {
        unpoll();
        fn();
        unobserve();
      };

      const unpoll = poll(
        async () => {
          if (count >= retryCount) {
            done(() => emit.reject(new WaitForOrderFillReceiptTimeoutError({ orderHash })));
            return;
          }

          try {
            const receipt = await (client.gravitonClient.request as any)({
              method: 'gv_getOrderFillReceipt',
              params: {
                orderHash,
                chainId,
                interopExecutor,
              },
            });

            if (receipt) {
              done(() =>
                emit.resolve({
                  event: {
                    ...receipt.event,
                    srcChainId: BigInt(receipt.event.srcChainId),
                  },
                  transaction: {
                    ...receipt.transaction,
                    blockNumber: BigInt(receipt.transaction.blockNumber),
                    gasUsed: BigInt(receipt.transaction.gasUsed),
                  },
                }),
              );
            }
          } catch (_err) {
            // Continue polling on error
          }

          count++;
        },
        {
          emitOnBegin: true,
          interval: pollingInterval,
        },
      );

      if (timeout) {
        setTimeout(
          () => done(() => emit.reject(new WaitForOrderFillReceiptTimeoutError({ orderHash }))),
          timeout,
        );
      }

      return unpoll;
    });
  });
}
