import type { Address, Hex } from 'viem';
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  isAddressEqual,
  maxUint160,
  maxUint256,
  toHex,
  zeroAddress,
} from 'viem';
import {
  createLogger,
  getPublicClient,
  UNISWAP_V4_QUOTER_ABI,
  UNISWAP_V4_ROUTER_ABI,
  PERMIT2_ABI,
} from '@graviton/core';
import { config } from '../../config/index.js';

export interface Call {
  to: Address;
  data: Hex;
  value: bigint;
}

// Permit2 canonical address (same on all chains)
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;

const logger = createLogger('swap-quoter', config.log.level);

// Uniswap V4 contract addresses by chain
const V4_ADDRESSES: Record<
  number,
  { quoter: Address; universalRouter: Address; poolManager: Address }
> = {
  // Ethereum Mainnet
  1: {
    quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
    universalRouter: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
    poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
  },
  // Optimism
  10: {
    quoter: '0x1f3131a13296fb91c90870043742c3cdbff1a8d7',
    universalRouter: '0x851116d9223fabed8e56c0e6b8ad0c31d98b3507',
    poolManager: '0x9a13f98cb987694c9f086b1f5eb990eea8264ec3',
  },
  // Base
  8453: {
    quoter: '0x0d5e0f971ed27fbff6c2837bf31316121532048d',
    universalRouter: '0x6ff5693b99212da76ad316178a184ab56d299b43',
    poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
  },
  // Arbitrum One
  42161: {
    quoter: '0x3972c00f7ed4885e145823eb7c655375d275a1c5',
    universalRouter: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
    poolManager: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
  },
};

// Standard fee tiers for Uniswap V4 (in hundredths of a bip)
const FEE_TIERS = [20, 500] as const;

// Standard tick spacings for each fee tier
const TICK_SPACING = {
  20: 1,
  500: 10,
  3000: 60,
  10000: 200,
} as const;

function getTickSpacing(fee: number): number {
  const spacing = TICK_SPACING[fee as keyof typeof TICK_SPACING];
  if (spacing === undefined) {
    throw new Error(`Unknown fee tier: ${fee}`);
  }
  return spacing;
}

export type SwapType = 'exactInput' | 'exactOutput';

export interface SwapQuote {
  inputToken: Address;
  outputToken: Address;
  inputAmount: bigint;
  outputAmount: bigint;
  gasEstimate: bigint;
  calls: Call[];
}

// V4Router action constants (command 0x10 = V4_SWAP)
const Actions = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_OUT_SINGLE: 0x08,
  SETTLE_ALL: 0x0c,
  TAKE_ALL: 0x0f,
} as const;

export class SwapQuoteFetcher {
  /**
   * Get a swap quote from Uniswap V4
   *
   * @param chainId - Chain ID to get the quote on
   * @param inputToken - Address of the input token
   * @param outputToken - Address of the output token
   * @param amount - Amount in wei (input amount for exactInput, output amount for exactOutput)
   * @param type - Type of swap: exactInput or exactOutput
   * @param account - Address of the account (for checking/building approval calls)
   * @param recipient - Address to receive the swapped tokens
   * @param slippageBps - Slippage tolerance in basis points (default 50 = 0.5%)
   */
  async getSwapQuote(
    chainId: number,
    inputToken: Address,
    outputToken: Address,
    amount: bigint,
    type: SwapType,
    account: Address,
    slippageBps: number = 50
  ): Promise<SwapQuote> {
    logger.info(
      {
        chainId,
        inputToken,
        outputToken,
        amount: amount.toString(),
        type,
        account,
        slippageBps,
      },
      'Fetching swap quote from Uniswap V4'
    );

    const addresses = V4_ADDRESSES[chainId];
    if (!addresses) {
      throw new Error(`Uniswap V4 not supported on chain ${chainId}`);
    }

    const client = getPublicClient(chainId);

    // Sort tokens to get currency0 and currency1 (V4 requires sorted order)
    const [currency0, currency1] = this.sortTokens(inputToken, outputToken);
    const zeroForOne = isAddressEqual(inputToken, currency0);

    // Try each fee tier to find the best quote
    const quotes = await Promise.allSettled(
      FEE_TIERS.map((fee) =>
        this.getQuoteForFee(
          client,
          addresses.quoter,
          inputToken,
          outputToken,
          amount,
          type,
          fee
        )
      )
    );

    // Find the best quote (highest output for exactInput, lowest input for exactOutput)
    let bestQuote: {
      amountResult: bigint;
      gasEstimate: bigint;
      fee: number;
    } | null = null;

    for (const result of quotes) {
      if (result.status === 'fulfilled' && result.value) {
        const quote = result.value;
        if (!bestQuote) {
          bestQuote = quote;
        } else if (type === 'exactInput') {
          // For exactInput, we want the highest output
          if (quote.amountResult > bestQuote.amountResult) {
            bestQuote = quote;
          }
        } else {
          // For exactOutput, we want the lowest input
          if (quote.amountResult < bestQuote.amountResult) {
            bestQuote = quote;
          }
        }
      }
    }

    if (!bestQuote) {
      throw new Error(
        `No liquidity found for swap ${inputToken} -> ${outputToken} on chain ${chainId}`
      );
    }

    // Calculate amounts based on swap type
    const inputAmount = type === 'exactInput' ? amount : bestQuote.amountResult;
    const outputAmount =
      type === 'exactInput' ? bestQuote.amountResult : amount;

    // Calculate max input amount with slippage for approval checks
    const maxInputAmount =
      type === 'exactInput'
        ? inputAmount
        : (inputAmount * BigInt(10000 + slippageBps)) / 10000n;

    // Get approval calls for the input token
    const approvalCalls = await this.getApprovalCalls(
      client,
      inputToken,
      maxInputAmount,
      account,
      addresses.universalRouter
    );

    // Build swap call with slippage protection
    const swapCall = this.buildSwapCallData(
      addresses.universalRouter,
      currency0,
      currency1,
      inputAmount,
      outputAmount,
      bestQuote.fee,
      type,
      zeroForOne,
      slippageBps
    );

    const swapQuote: SwapQuote = {
      inputToken,
      outputToken,
      inputAmount,
      outputAmount,
      gasEstimate: bestQuote.gasEstimate,
      calls: [...approvalCalls, swapCall],
    };

    logger.info(
      {
        inputAmount: inputAmount.toString(),
        outputAmount: outputAmount.toString(),
        fee: bestQuote.fee,
        gasEstimate: bestQuote.gasEstimate.toString(),
      },
      'Successfully fetched swap quote'
    );

    return swapQuote;
  }

  private sortTokens(tokenA: Address, tokenB: Address): [Address, Address] {
    return tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];
  }

  private async getApprovalCalls(
    client: ReturnType<typeof getPublicClient>,
    token: Address,
    amount: bigint,
    owner: Address,
    universalRouter: Address
  ): Promise<Call[]> {
    const calls: Call[] = [];

    // Check ERC20 allowance to Permit2
    const erc20Allowance = await client.readContract({
      abi: erc20Abi,
      address: token,
      functionName: 'allowance',
      args: [owner, PERMIT2],
    });

    if (erc20Allowance < amount) {
      logger.info('Appending call: Approving token to Permit2...');
      calls.push({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [PERMIT2, maxUint256],
        }),
        value: 0n,
      });
    }

    // Check Permit2 allowance to Universal Router
    const [permit2Amount, expiration] = await client.readContract({
      abi: PERMIT2_ABI,
      address: PERMIT2,
      functionName: 'allowance',
      args: [owner, token, universalRouter],
    });

    const now = Math.floor(Date.now() / 1000);
    if (permit2Amount < amount || expiration < now) {
      logger.info(
        'Appending call: Approving Permit2 allowance to Universal Router...'
      );
      // Set expiration to 30 days from now
      const newExpiration = now + 30 * 24 * 60 * 60;
      calls.push({
        to: PERMIT2,
        data: encodeFunctionData({
          abi: PERMIT2_ABI,
          functionName: 'approve',
          args: [token, universalRouter, maxUint160, newExpiration],
        }),
        value: 0n,
      });
    }

    return calls;
  }

  private async getQuoteForFee(
    client: ReturnType<typeof getPublicClient>,
    quoterAddress: Address,
    inputToken: Address,
    outputToken: Address,
    amount: bigint,
    type: SwapType,
    fee: number
  ): Promise<{
    amountResult: bigint;
    gasEstimate: bigint;
    fee: number;
  }> {
    const tickSpacing = getTickSpacing(fee);

    const functionName =
      type === 'exactInput' ? 'quoteExactInput' : 'quoteExactOutput';
    const exactCurrency = type === 'exactInput' ? inputToken : outputToken;
    const intermediateCurrency =
      type === 'exactInput' ? outputToken : inputToken;

    // V4 quoter uses callStatic since it reverts internally to return data
    const result = await client.simulateContract({
      address: quoterAddress,
      abi: UNISWAP_V4_QUOTER_ABI,
      functionName,
      args: [
        {
          exactCurrency: exactCurrency,
          path: [
            {
              intermediateCurrency,
              fee,
              tickSpacing,
              hooks: zeroAddress,
              hookData: '0x' as Hex,
            },
          ],
          exactAmount: amount,
        },
      ],
    });

    const [amountResult, gasEstimate] = result.result as [bigint, bigint];

    return {
      amountResult,
      gasEstimate,
      fee,
    };
  }

  private buildSwapCallData(
    routerAddress: Address,
    currency0: Address,
    currency1: Address,
    inputAmount: bigint,
    outputAmount: bigint,
    fee: number,
    type: SwapType,
    zeroForOne: boolean,
    slippageBps: number,
    hookData: Hex = '0x'
  ): Call {
    const tickSpacing = getTickSpacing(fee);

    // Build pool key
    const poolKey = {
      currency0,
      currency1,
      fee,
      tickSpacing,
      hooks: zeroAddress,
    };

    // Determine input/output currencies based on direction
    const inputCurrency = zeroForOne ? currency0 : currency1;
    const outputCurrency = zeroForOne ? currency1 : currency0;

    // V4_SWAP command = 0x10
    const commands = '0x10' as Hex;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 minutes

    if (type === 'exactInput') {
      // Calculate minimum output with slippage
      const amountOutMinimum =
        (outputAmount * BigInt(10000 - slippageBps)) / 10000n;

      // Encode actions: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
      const actions = concat([
        toHex(Actions.SWAP_EXACT_IN_SINGLE, { size: 1 }),
        toHex(Actions.SETTLE_ALL, { size: 1 }),
        toHex(Actions.TAKE_ALL, { size: 1 }),
      ]);

      // Encode swap params
      const swapParams = encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              {
                type: 'tuple',
                name: 'poolKey',
                components: [
                  { type: 'address', name: 'currency0' },
                  { type: 'address', name: 'currency1' },
                  { type: 'uint24', name: 'fee' },
                  { type: 'int24', name: 'tickSpacing' },
                  { type: 'address', name: 'hooks' },
                ],
              },
              { type: 'bool', name: 'zeroForOne' },
              { type: 'uint128', name: 'amountIn' },
              { type: 'uint128', name: 'amountOutMinimum' },
              { type: 'bytes', name: 'hookData' },
            ],
          },
        ],
        [
          {
            poolKey,
            zeroForOne,
            amountIn: inputAmount,
            amountOutMinimum,
            hookData,
          },
        ]
      );

      // SETTLE_ALL params: (currency, maxAmount)
      const settleParams = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint128' }],
        [inputCurrency, inputAmount]
      );

      // TAKE_ALL params: (currency, minAmount)
      const takeParams = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint128' }],
        [outputCurrency, amountOutMinimum]
      );

      // Combine actions and params into single input
      const input = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes[]' }],
        [actions, [swapParams, settleParams, takeParams]]
      );

      return {
        to: routerAddress,
        data: encodeFunctionData({
          abi: UNISWAP_V4_ROUTER_ABI,
          functionName: 'execute',
          args: [commands, [input], deadline],
        }),
        value: 0n,
      };
    } else {
      // exactOutput
      // Calculate maximum input with slippage
      const amountInMaximum =
        (inputAmount * BigInt(10000 + slippageBps)) / 10000n;

      // Encode actions: SWAP_EXACT_OUT_SINGLE, SETTLE_ALL, TAKE_ALL
      const actions = concat([
        toHex(Actions.SWAP_EXACT_OUT_SINGLE, { size: 1 }),
        toHex(Actions.SETTLE_ALL, { size: 1 }),
        toHex(Actions.TAKE_ALL, { size: 1 }),
      ]);

      // Encode swap params
      const swapParams = encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              {
                type: 'tuple',
                name: 'poolKey',
                components: [
                  { type: 'address', name: 'currency0' },
                  { type: 'address', name: 'currency1' },
                  { type: 'uint24', name: 'fee' },
                  { type: 'int24', name: 'tickSpacing' },
                  { type: 'address', name: 'hooks' },
                ],
              },
              { type: 'bool', name: 'zeroForOne' },
              { type: 'uint128', name: 'amountOut' },
              { type: 'uint128', name: 'amountInMaximum' },
              { type: 'bytes', name: 'hookData' },
            ],
          },
        ],
        [
          {
            poolKey,
            zeroForOne,
            amountOut: outputAmount,
            amountInMaximum,
            hookData,
          },
        ]
      );

      // SETTLE_ALL params: (currency, maxAmount)
      const settleParams = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint128' }],
        [inputCurrency, amountInMaximum]
      );

      // TAKE_ALL params: (currency, minAmount)
      const takeParams = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint128' }],
        [outputCurrency, outputAmount]
      );

      // Combine actions and params into single input
      const input = encodeAbiParameters(
        [{ type: 'bytes' }, { type: 'bytes[]' }],
        [actions, [swapParams, settleParams, takeParams]]
      );

      return {
        to: routerAddress,
        data: encodeFunctionData({
          abi: UNISWAP_V4_ROUTER_ABI,
          functionName: 'execute',
          args: [commands, [input], deadline],
        }),
        value: 0n,
      };
    }
  }

  /**
   * Get the Universal Router address for a chain
   */
  getSwapRouterAddress(chainId: number): Address {
    const addresses = V4_ADDRESSES[chainId];
    if (!addresses) {
      throw new Error(`Uniswap V4 not supported on chain ${chainId}`);
    }
    return addresses.universalRouter;
  }
}
