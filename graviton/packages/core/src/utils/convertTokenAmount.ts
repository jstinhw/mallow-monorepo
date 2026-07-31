import { type Address, isAddressEqual } from 'viem';
import { getTokenDecimals } from '../constants/index.js';
import { oracleRegistry } from '../oracles/index.js';

/**
 * Convert an amount from one token to another using oracle prices
 *
 * Formula:
 *   valueUsd = amountIn * priceIn / 10^tokenInDecimals / 10^priceInDecimals
 *   amountOut = valueUsd * 10^tokenOutDecimals * 10^priceOutDecimals / priceOut
 *
 * Combined (assuming priceInDecimals == priceOutDecimals):
 *   amountOut = amountIn * priceIn * 10^tokenOutDecimals / (priceOut * 10^tokenInDecimals)
 *
 * @param chainId - The chain ID
 * @param tokenIn - The input token address
 * @param tokenOut - The output token address
 * @param amountIn - The amount of input token (in token's smallest unit)
 * @returns The equivalent amount in the output token (in token's smallest unit)
 */
export async function convertTokenAmount(
  chainId: number,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint
): Promise<bigint> {
  // If same token, return the same amount
  if (isAddressEqual(tokenIn, tokenOut)) {
    return amountIn;
  }

  // Get decimals if not provided
  const inDecimals = getTokenDecimals(chainId, tokenIn);
  const outDecimals = getTokenDecimals(chainId, tokenOut);

  // Get prices for both tokens
  const [priceIn, priceOut] = await Promise.all([
    oracleRegistry.fetchPrice(chainId, tokenIn),
    oracleRegistry.fetchPrice(chainId, tokenOut),
  ]);

  // Convert using the formula:
  // amountOut = amountIn * priceIn * 10^outDecimals / (priceOut * 10^inDecimals)
  const numerator = amountIn * priceIn.price * 10n ** BigInt(outDecimals);
  const denominator = priceOut.price * 10n ** BigInt(inDecimals);

  return numerator / denominator;
}
