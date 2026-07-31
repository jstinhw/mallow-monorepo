import { custom, type Transport } from 'viem';
import { TransportError } from '../utils/errors.js';
import type { GravitonTransportConfig } from './types.js';

/**
 * Creates a custom transport for communicating with the Graviton API via JSON-RPC 2.0.
 *
 * @param config - Transport configuration
 * @returns A viem Transport instance configured for Graviton API
 *
 * @example
 * ```typescript
 * import { graviton } from '@graviton/sdk';
 *
 * const transport = graviton({
 *   url: 'https://api.graviton.xyz',
 *   timeout: 30000,
 *   retryCount: 3,
 * });
 * ```
 */
export function graviton(config: GravitonTransportConfig): Transport {
  const { url, timeout = 30_000, retryCount = 3, retryDelay = 150 } = config;

  return custom({
    async request({ method, params }) {
      let lastError: Error | null = null;

      // Retry logic
      for (let attempt = 0; attempt <= retryCount; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method,
              params,
              id: Date.now(),
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorData: any = await response.json().catch(() => ({}));
            throw new TransportError(
              `HTTP ${response.status}: ${response.statusText}${errorData.error ? ` - ${JSON.stringify(errorData.error)}` : ''}`,
            );
          }

          const data: any = await response.json();

          if (data.error) {
            throw new TransportError(
              `JSON-RPC error (code: ${data.error.code}): ${data.error.message}`,
            );
          }

          return data.result;
        } catch (error) {
          lastError = error as Error;

          // Don't retry on abort (timeout)
          if (error instanceof Error && error.name === 'AbortError') {
            throw new TransportError(`Request timeout after ${timeout}ms`);
          }

          // If this isn't the last attempt, wait before retrying
          if (attempt < retryCount) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
            continue;
          }

          // On last attempt, throw the error
          throw lastError;
        }
      }

      // This should never be reached, but TypeScript needs it
      throw lastError || new TransportError('Unknown error occurred');
    },
  })({
    retryCount: 0, // We handle retries internally
  }) as unknown as Transport;
}
