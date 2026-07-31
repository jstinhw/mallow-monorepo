import { type Address, concatHex, decodeFunctionData } from 'viem';
import { account7579Abi } from '../abis/Account7579Abi.js';
import type { InteropClient } from '../clients/types.js';
import type { BridgeType, Call, ExecutionCall, Order } from '../types/order.js';
import { PrepareOrdersError } from '../utils/errors.js';
import { deserializeBigInt, serializeBigInt } from '../utils/serialization.js';

export type QuoteToken = {
  /** Chain ID where the token exists */
  chainId: number;
  /** Token contract address */
  address: Address;
  /** Amount to transfer */
  amount: bigint;
};

/**
 * Source token candidate for order preparation
 */
export type SrcToken = {
  /** Chain ID where the token exists */
  chainId: number;
  /** Token contract address */
  address: Address;
  /** Amount to transfer */
  amount?: bigint;
};

/**
 * Target token to receive on destination chain
 */
export type TargetToken = {
  /** Token contract address */
  address: Address;
  /** Amount to receive */
  amount: bigint;
};

/**
 * Parameters for preparing orders
 */
export type PrepareOrdersParameters = {
  /** Target chain ID for order execution */
  targetChainId: number;
  /** Target tokens to receive */
  targetTokens: TargetToken[];
  /** Execution calls on target chain */
  calls: Call[];
  /** Source token candidates for payment */
  srcTokens: SrcToken[];
  /** Bridge type optional */
  bridgeType?: BridgeType;
};

/**
 * Return type for prepareOrders
 */
export type PrepareOrdersReturnType = {
  /** Prepared orders ready for signing */
  orders: Order[];
  /** Quote tokens for payment */
  inputTokens: QuoteToken[];
  /** Output tokens to receive */
  outputTokens: QuoteToken[];
};

/**
 * Prepares cross-chain orders by calling the Graviton API.
 *
 * This action analyzes available source tokens and creates optimized orders
 * for cross-chain execution. The API handles:
 * - Route optimization
 * - Fee calculation
 * - Bridge adapter selection
 * - Payment token allocation
 *
 * @param client - The Interop Client
 * @param parameters - Order preparation parameters
 * @returns Prepared orders ready for signing
 *
 * @example
 * ```typescript
 * const { orders } = await client.prepareOrders({
 *   sender: kernelAccount.address,
 *   initData: await kernelAccount.generateInitCode(),
 *   targetChainId: base.id,
 *   targetTokens: [{ address: usdcBase, amount: parseUnits('10', 6) }],
 *   targetCalls: [{
 *     data: encodeFunctionData({
 *       abi: erc20Abi,
 *       functionName: 'transfer',
 *       args: [recipient, parseUnits('10', 6)],
 *     }),
 *     mode: '0x00...',
 *   }],
 *   srcTokens: [{ chainId: arbitrum.id, address: usdcArbitrum }],
 * });
 * ```
 */
export async function prepareOrders(
  client: InteropClient,
  parameters: PrepareOrdersParameters,
): Promise<PrepareOrdersReturnType> {
  const { account } = client;
  const { targetChainId, targetTokens, calls, srcTokens, bridgeType } = parameters;

  try {
    const sender = account.address;

    // construct init code
    const factoryAddress = account.factoryAddress;
    const factoryData = await account.generateInitCode();
    const initData = concatHex([factoryAddress, factoryData]);

    // construct execution calls
    const executionCalldata = await account.encodeCalls(calls);
    const { args } = decodeFunctionData({
      abi: account7579Abi,
      data: executionCalldata,
    });
    const [execMode, execCallData] = args;
    const targetCalls: ExecutionCall[] = [
      {
        data: execCallData,
        mode: execMode,
      },
    ];

    const result = await (client.gravitonClient.request as any)({
      method: 'gv_prepareOrders',
      params: serializeBigInt({
        sender,
        initData,
        targetChainId,
        targetTokens,
        targetCalls,
        srcTokens,
        bridgeType,
      }),
    });

    return deserializeBigInt(result) as PrepareOrdersReturnType;
  } catch (error) {
    throw new PrepareOrdersError(error instanceof Error ? error.message : 'Unknown error');
  }
}
