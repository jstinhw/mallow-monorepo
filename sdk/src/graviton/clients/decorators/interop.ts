import {
  type PrepareOrdersParameters,
  type PrepareOrdersReturnType,
  prepareOrders,
} from '../../actions/prepareOrders.js';
import {
  type SendOrdersParameters,
  type SendOrdersReturnType,
  sendOrders,
} from '../../actions/sendOrders.js';
import {
  type WaitForOrderFillReceiptParameters,
  type WaitForOrderFillReceiptReturnType,
  waitForOrderFillReceipt,
} from '../../actions/waitForOrderFillReceipt.js';
import {
  type WaitForOrderOpenReceiptParameters,
  type WaitForOrderOpenReceiptReturnType,
  waitForOrderOpenReceipt,
} from '../../actions/waitForOrderOpenReceipt.js';
import type { InteropClient } from '../types.js';

/**
 * Interop Actions that are extended onto the client
 */
export type InteropActions = {
  /**
   * Prepares cross-chain orders via the Graviton API
   */
  prepareOrders(parameters: PrepareOrdersParameters): Promise<PrepareOrdersReturnType>;

  /**
   * Signs and submits orders to the Graviton network
   */
  sendOrders(parameters: SendOrdersParameters): Promise<SendOrdersReturnType>;

  /**
   * Waits for an order to be opened on the source chain
   */
  waitForOrderOpenReceipt(
    parameters: WaitForOrderOpenReceiptParameters,
  ): Promise<WaitForOrderOpenReceiptReturnType>;

  /**
   * Waits for an order to be filled on the target chain
   */
  waitForOrderFillReceipt(
    parameters: WaitForOrderFillReceiptParameters,
  ): Promise<WaitForOrderFillReceiptReturnType>;
};

/**
 * Decorator function that extends an Interop Client with interop actions.
 * This follows the viem pattern of extending clients with action sets.
 *
 * @param client - The Interop Client to extend
 * @returns An object with bound action methods
 */
export const interopActions = (client: InteropClient): InteropActions => ({
  prepareOrders: (params) => prepareOrders(client, params),
  sendOrders: (params) => sendOrders(client, params),
  waitForOrderOpenReceipt: (params) => waitForOrderOpenReceipt(client, params),
  waitForOrderFillReceipt: (params) => waitForOrderFillReceipt(client, params),
});
