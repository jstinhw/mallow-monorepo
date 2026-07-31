/**
 * Configuration options for the Graviton transport
 */
export type GravitonTransportConfig = {
  /**
   * Graviton API URL endpoint
   */
  url: string;

  /**
   * Request timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Number of retry attempts for failed requests
   * @default 3
   */
  retryCount?: number;

  /**
   * Base delay in milliseconds between retry attempts
   * The actual delay increases with each retry: retryDelay * (attempt + 1)
   * @default 150
   */
  retryDelay?: number;
};
