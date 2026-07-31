import type { KernelSmartAccountImplementation } from '@zerodev/sdk';
import type { Client, Prettify, RpcSchema, Transport } from 'viem';
import type { SmartAccount } from 'viem/account-abstraction';
import type { InteropVersion } from '../utils/installInteropExecutor.js';
import type { InteropActions } from './decorators/interop.js';

/**
 * Configuration for creating an Interop Client
 */
export type InteropClientConfig = {
  /**
   * Kernel smart account with interop executor installed.
   * Create this using @zerodev/sdk's createKernelAccount with installInteropExecutor helper.
   */
  account: SmartAccount<KernelSmartAccountImplementation>;

  /**
   * Transport for Graviton API operations
   * Use the graviton() transport function for this
   * Defaults to http(GRAVITON_API_URL) if not provided
   */
  gravitonTransport?: Transport;

  /**
   * Graviton protocol version
   */
  version: InteropVersion;

  /**
   * Graviton API endpoint URL
   * This is stored on the client for convenience in actions
   */
  gravitonUrl?: string;
};

/**
 * Interop Client with extended actions for cross-chain intent settlement
 */
export type InteropClient<
  transport extends Transport = Transport,
  account extends SmartAccount<KernelSmartAccountImplementation> =
    SmartAccount<KernelSmartAccountImplementation>,
  rpcSchema extends RpcSchema | undefined = undefined,
> = Prettify<Client<transport, undefined, account, rpcSchema, InteropActions>> & {
  /** Client for Graviton API operations */
  gravitonClient: Client<Transport>;
  /** Graviton protocol version */
  version: InteropVersion;
  /** Graviton API URL */
  gravitonUrl: string;
};
