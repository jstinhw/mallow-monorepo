import type { Hash } from 'viem';
import type { InteropClient } from '../clients/types.js';
import type { Order } from '../types/order.js';
import { SendOrdersError } from '../utils/errors.js';
import { signOrders } from '../utils/signOrders.js';

/**
 * Parameters for sending orders
 */
export type SendOrdersParameters = {
  /** Unsigned orders to sign and send */
  orders: Order[];
};

/**
 * Return type for sendOrders
 */
export type SendOrdersReturnType = {
  /** Target chain ID for order execution */
  targetChainId: string;
  /** Order hashes and their source chain IDs */
  orderHashes: {
    /** Hash of the order */
    orderHash: Hash;
    /** Source chain ID where the order opens */
    chainId: string;
  }[];
};

/**
 * Signs and submits orders to the Graviton network.
 *
 * This action:
 * 1. Signs all orders using Merkle tree batching (one signature for multiple orders)
 * 2. Submits the signed orders to the Graviton API
 * 3. Returns order hashes for tracking
 *
 * The Merkle tree signing approach is efficient for batching: a single ECDSA signature
 * covers multiple orders, with each order including a Merkle proof.
 *
 * @param client - The Interop Client
 * @param parameters - Orders to sign and send
 * @returns Order hashes and chain IDs for tracking execution
 *
 * @example
 * ```typescript
 * const { orders } = await client.prepareOrders({ ... });
 *
 * const { orderHashes, targetChainId } = await client.sendOrders({ orders });
 *
 * console.log('Order submitted:', orderHashes[0].orderHash);
 * console.log('Source chain:', orderHashes[0].chainId);
 * console.log('Target chain:', targetChainId);
 * ```
 */
export async function sendOrders(
  client: InteropClient,
  parameters: SendOrdersParameters,
): Promise<SendOrdersReturnType> {
  const { orders } = parameters;

  try {
    // Sign orders using Merkle tree (internal utility)
    const signedOrders = await signOrders({
      kernelAccount: client.account!,
      orders,
    });

    // Send to Graviton API
    const result = await (client.gravitonClient.request as any)({
      method: 'gv_sendOrders',
      params: {
        orders: signedOrders,
      },
    });

    return result as SendOrdersReturnType;
  } catch (error) {
    throw new SendOrdersError(error instanceof Error ? error.message : 'Unknown error');
  }
}
