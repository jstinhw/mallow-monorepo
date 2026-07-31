import { encodeAbiParameters, type Hex, keccak256 } from 'viem';
import type { Order } from '../types/order.js';

/**
 * Computes the keccak256 hash of an order.
 * This hash is used for order identification and signing.
 *
 * @param order - The order to hash
 * @returns The keccak256 hash of the encoded order
 */
export function getOrderHash(order: Order): Hex {
  const { sender, openDeadline, fillDeadline, initData, targetIntent, srcIntent } = order;

  return keccak256(
    encodeAbiParameters(
      [
        { name: 'sender', type: 'address' },
        { name: 'openDeadline', type: 'uint32' },
        { name: 'fillDeadline', type: 'uint32' },
        { name: 'initData', type: 'bytes' },
        {
          name: 'targetIntent',
          type: 'tuple',
          components: [
            { name: 'nonce', type: 'uint256' },
            { name: 'chainId', type: 'uint256' },
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
            {
              name: 'validations',
              type: 'tuple[]',
              components: [
                { name: 'validator', type: 'address' },
                { name: 'data', type: 'bytes' },
              ],
            },
            {
              name: 'executions',
              type: 'tuple[]',
              components: [
                { name: 'data', type: 'bytes' },
                { name: 'mode', type: 'bytes32' },
              ],
            },
          ],
        },
        {
          name: 'srcIntent',
          type: 'tuple',
          components: [
            { name: 'chainId', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            {
              name: 'paymentTokens',
              type: 'tuple[]',
              components: [
                { name: 'recipient', type: 'address' },
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint256' },
              ],
            },
            {
              name: 'preHooks',
              type: 'tuple[]',
              components: [
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'data', type: 'bytes' },
              ],
            },
            {
              name: 'postHooks',
              type: 'tuple[]',
              components: [
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'data', type: 'bytes' },
              ],
            },
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'adapter', type: 'address' },
            { name: 'adapterData', type: 'bytes' },
          ],
        },
      ],
      [sender, openDeadline, fillDeadline, initData, targetIntent, srcIntent],
    ),
  );
}
