import type { Hash } from 'viem';

/**
 * Base error class for all Graviton SDK errors
 */
export class GravitonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GravitonError';
  }
}

/**
 * Error thrown when waiting for order open receipt times out
 */
export class WaitForOrderOpenReceiptTimeoutError extends GravitonError {
  constructor({ orderHash }: { orderHash: Hash }) {
    super(`Timed out waiting for order open receipt: ${orderHash}`);
    this.name = 'WaitForOrderOpenReceiptTimeoutError';
  }
}

/**
 * Error thrown when waiting for order fill receipt times out
 */
export class WaitForOrderFillReceiptTimeoutError extends GravitonError {
  constructor({ orderHash }: { orderHash: Hash }) {
    super(`Timed out waiting for order fill receipt: ${orderHash}`);
    this.name = 'WaitForOrderFillReceiptTimeoutError';
  }
}

/**
 * Error thrown when order preparation fails
 */
export class PrepareOrdersError extends GravitonError {
  constructor(message: string) {
    super(`Failed to prepare orders: ${message}`);
    this.name = 'PrepareOrdersError';
  }
}

/**
 * Error thrown when order submission fails
 */
export class SendOrdersError extends GravitonError {
  constructor(message: string) {
    super(`Failed to send orders: ${message}`);
    this.name = 'SendOrdersError';
  }
}

/**
 * Error thrown when transport request fails
 */
export class TransportError extends GravitonError {
  constructor(message: string) {
    super(`Transport error: ${message}`);
    this.name = 'TransportError';
  }
}
