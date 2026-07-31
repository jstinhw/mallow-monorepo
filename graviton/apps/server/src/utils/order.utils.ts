import type { Hex, Address, Call } from 'viem';
import { encodeAbiParameters, encodePacked } from 'viem';
import type { ExecutionCall } from '@graviton/core';
import { CCTP_DOMAINS, LZ_ENDPOINT_IDS } from '../constants/contracts.js';

// ERC-7579 execution mode for single CALL with default execution
const SINGLE_CALL_MODE =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

// ERC-7579 execution mode for batch CALL
const BATCH_CALL_MODE =
  '0x0100000000000000000000000000000000000000000000000000000000000000' as Hex;

/**
 * Normalize token amount between different decimal places
 */
export function normalizeAmount(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number
): bigint {
  if (fromDecimals === toDecimals) return amount;
  if (fromDecimals > toDecimals) {
    return amount / BigInt(10 ** (fromDecimals - toDecimals));
  }
  return amount * BigInt(10 ** (toDecimals - fromDecimals));
}

/**
 * Get CCTP domain ID for a given chain ID
 */
export function getCCTPDomain(chainId: bigint): number {
  const domain = CCTP_DOMAINS[Number(chainId)];
  if (domain === undefined) {
    throw new Error(`No CCTP domain configured for chain ${chainId}`);
  }
  return domain;
}

/**
 * Encode CCTP adapter data for cross-chain transfers
 */
export function encodeCCTPAdapterData(params: {
  destinationDomain: number;
  destinationCaller: Hex;
  maxFee: bigint;
  minFinalityThreshold: number;
}): Hex {
  return encodeAbiParameters(
    [
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint256' },
    ],
    [
      params.destinationDomain,
      params.destinationCaller,
      params.maxFee,
      BigInt(params.minFinalityThreshold),
    ]
  );
}

/**
 * Encode balance validator data
 */
export function encodeBalanceValidatorData(amount: bigint): Hex {
  return encodeAbiParameters([{ name: 'amount', type: 'uint256' }], [amount]);
}

/**
 * Calculate fee amount based on balance and BPS
 */
export function calculateFee(
  balance: bigint,
  bps: bigint,
  gasAmount: bigint,
  baseDecimals: number
): bigint {
  const bpsFee = (balance * bps) / BigInt(10 ** baseDecimals);
  return bpsFee + gasAmount;
}

/**
 * Calculate source amount from target amount and fees
 */
export function calculateSourceAmount(
  targetAmount: bigint,
  bps: bigint,
  baseDecimals: number
): bigint {
  const baseUnit = BigInt(10 ** baseDecimals);
  const denominator = baseUnit - bps;
  return (targetAmount * baseUnit + denominator - 1n) / denominator;
}

/**
 * Encode a call into ERC-7579 ExecutionCall format
 * Uses single CALL mode with default execution
 */
export function encodeExecutionCall(calls: Call[]): ExecutionCall[] {
  if (calls.length === 0) {
    return [];
  }
  if (calls.length === 1) {
    const call = calls[0]!;
    const executionData = encodePacked(
      ['address', 'uint256', 'bytes'],
      [call.to, BigInt(call.value || '0'), call.data || '0x']
    );

    return [
      {
        data: executionData,
        mode: SINGLE_CALL_MODE,
      },
    ];
  }

  const calldata = encodeAbiParameters(
    [
      {
        name: 'executionBatch',
        type: 'tuple[]',
        components: [
          {
            name: 'target',
            type: 'address',
          },
          {
            name: 'value',
            type: 'uint256',
          },
          {
            name: 'callData',
            type: 'bytes',
          },
        ],
      },
    ],
    [
      calls.map((call) => {
        return {
          target: call.to,
          value: BigInt(call.value || '0'),
          callData: call.data || '0x',
        };
      }),
    ]
  );
  return [
    {
      data: calldata,
      mode: BATCH_CALL_MODE,
    },
  ];
}

/**
 * Check if a token is USDC on a given chain
 */
export function isUSDC(
  token: Address,
  chainId: bigint,
  usdcAddresses: Record<number, Address>
): boolean {
  const usdcAddress = usdcAddresses[Number(chainId)];
  if (!usdcAddress) return false;
  return token.toLowerCase() === usdcAddress.toLowerCase();
}

/**
 * Get LayerZero v2 endpoint ID for a given chain ID
 */
export function getLZEndpointId(chainId: bigint): number {
  const endpointId = LZ_ENDPOINT_IDS[Number(chainId)];
  if (endpointId === undefined) {
    throw new Error(`No LayerZero endpoint ID configured for chain ${chainId}`);
  }
  return endpointId;
}

/**
 * Encode LZ v2 Options (type 3 format):
 * 0x0003 + executorWorkerId(1byte) + optionLength(2bytes) + lzReceiveType(1byte) + gasLimit(uint128)
 */
export function encodeLZOptions(gasLimit: bigint): Hex {
  return encodePacked(
    ['uint16', 'uint8', 'uint16', 'uint8', 'uint128'],
    [3, 1, 17, 1, gasLimit]
  );
}

/**
 * Encode LayerZero adapter data matching the contract's abi.decode:
 * (uint32 dstEid, bytes options, address refundAddress)
 */
export function encodeLZAdapterData(params: {
  dstEid: number;
  options: Hex;
  refundAddress: Address;
}): Hex {
  return encodeAbiParameters(
    [
      { name: 'dstEid', type: 'uint32' },
      { name: 'options', type: 'bytes' },
      { name: 'refundAddress', type: 'address' },
    ],
    [params.dstEid, params.options, params.refundAddress]
  );
}
