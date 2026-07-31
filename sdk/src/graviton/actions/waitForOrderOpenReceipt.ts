import type { Address, Hash } from 'viem';
import { stringify } from 'viem/utils';
import type { InteropClient } from '../clients/types.js';
import { INTEROP_EXECUTOR } from '../constants/index.js';
import { WaitForOrderOpenReceiptTimeoutError } from '../utils/errors.js';
import { observe } from '../utils/observe.js';
import { poll } from '../utils/poll.js';

/**
 * Parameters for waiting for order open receipt
 */
export type WaitForOrderOpenReceiptParameters = {
  /** The hash of the order to track */
  orderHash: Hash;
  /** The chain ID where the order opens (source chain) */
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
   * @default 60000 (1 minute)
   */
  timeout?: number;
};

/**
 * Return type for waitForOrderOpenReceipt
 */
export type WaitForOrderOpenReceiptReturnType = {
  event: {
    orderHash: Hash;
    sender: Address;
    targetChainId: bigint;
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
 * Waits for an order to be opened on the source chain.
 *
 * This action polls the Graviton API until the order is opened or times out.
 * An order being "opened" means the source chain transaction has been confirmed
 * and funds have been locked for bridging.
 *
 * @param client - The Interop Client
 * @param parameters - Order tracking parameters
 * @returns Receipt information for the opened order
 *
 * @throws {WaitForOrderOpenReceiptTimeoutError} If polling times out
 *
 * @example
 * ```typescript
 * const { orderHashes } = await client.sendOrders({ orders });
 *
 * const openReceipt = await client.waitForOrderOpenReceipt({
 *   orderHash: orderHashes[0].orderHash,
 *   chainId: Number(orderHashes[0].chainId),
 *   interopExecutor: INTEROP_EXECUTOR,
 *   pollingInterval: 1000,
 *   timeout: 120000,
 * });
 *
 * console.log('Order opened:', openReceipt);
 * ```
 */
export async function waitForOrderOpenReceipt(
  client: InteropClient,
  parameters: WaitForOrderOpenReceiptParameters,
): Promise<WaitForOrderOpenReceiptReturnType> {
  const {
    orderHash,
    chainId,
    interopExecutor = INTEROP_EXECUTOR,
    pollingInterval = 500,
    retryCount = 120,
    timeout = 60_000,
  } = parameters;

  let count = 0;
  const observerId = stringify(['waitForOrderOpenReceipt', orderHash, chainId, interopExecutor]);

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
            done(() => emit.reject(new WaitForOrderOpenReceiptTimeoutError({ orderHash })));
            return;
          }

          try {
            const receipt = await (client.gravitonClient.request as any)({
              method: 'gv_getOrderOpenReceipt',
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
                    targetChainId: BigInt(receipt.event.targetChainId),
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
          () => done(() => emit.reject(new WaitForOrderOpenReceiptTimeoutError({ orderHash }))),
          timeout,
        );
      }

      return unpoll;
    });
  });
}
