import { KernelV3_3AccountAbi } from '@zerodev/sdk';
import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  parseAbiParameters,
  zeroAddress,
} from 'viem';
import { INTEROP_EXECUTOR } from '../constants/index.js';

/**
 * Interop protocol version
 */
export type InteropVersion = 'v0.4';

/**
 * Generates the initialization configuration for installing the Interop Executor module
 * on a Kernel v3.3 account.
 *
 * @param version - The interop protocol version (currently only 'v0.4' is supported)
 * @returns Hex-encoded function call data for installing the module
 *
 * @example
 * ```typescript
 * import { createKernelAccount } from '@zerodev/sdk';
 * import { installInteropExecutor } from '@graviton/sdk';
 *
 * const kernelAccount = await createKernelAccount(publicClient, {
 *   plugins: { sudo: ecdsaValidator },
 *   kernelVersion: KERNEL_V3_3,
 *   entryPoint: getEntryPoint('0.7'),
 *   initConfig: [installInteropExecutor('v0.4')],
 * });
 * ```
 */
export function installInteropExecutor(_version: InteropVersion): Hex {
  // Module type 2 represents an executor module in Kernel v3.3
  const moduleType = BigInt(2);

  // Empty initialization data for the module
  const moduleInitData = concatHex([
    zeroAddress,
    encodeAbiParameters(parseAbiParameters(['bytes', 'bytes']), ['0x', '0x']),
  ]);

  return encodeFunctionData({
    abi: KernelV3_3AccountAbi,
    functionName: 'installModule',
    args: [moduleType, INTEROP_EXECUTOR, moduleInitData],
  });
}
