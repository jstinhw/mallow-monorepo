import type { Address, Hex, Log } from 'viem';
import { erc20Abi, toHex, isAddressEqual } from 'viem';
import {
  INTEROP_EXECUTOR,
  PAYMENT_RECIPIENT_ADDRESS,
  LAYERZERO_ADAPTER,
  LZ_DEFAULT_NATIVE_FEE,
} from '../constants/contracts.js';
import { INTEROP_EXECUTOR_ABI } from '@graviton/core/abis';
import {
  getPublicClient,
  getTokenBalanceSlot,
  serializeBigInt,
  type Order,
} from '@graviton/core';
import {
  relayerClient,
  type JsonStateOverride,
} from './clients/relayer.client.js';
import { GasEstimationError } from '../errors/index.js';

interface LogWithArgs extends Log {
  args: {
    orderHash?: Hex;
    sender?: Address;
    targetChainId?: bigint;
    srcChainId?: bigint;
  };
}

/**
 * Service for interacting with blockchain networks
 */
export class ChainService {
  private eventCache: Map<string, LogWithArgs>;
  private readonly BLOCK_RANGE = 5000n;

  constructor() {
    this.eventCache = new Map();
  }

  getGasPrice(chainId: bigint): Promise<bigint> {
    const client = getPublicClient(chainId);
    return client.getGasPrice();
  }

  /**
   * Get execution nonce for an account on the target chain
   */
  async getExecutionNonce(chainId: bigint, account: Address): Promise<bigint> {
    const client = getPublicClient(chainId);
    return await client.readContract({
      address: INTEROP_EXECUTOR,
      abi: INTEROP_EXECUTOR_ABI,
      functionName: 'executionNonce',
      args: [account],
    });
  }

  /**
   * Get payment nonce for an account on the source chain
   */
  async getPaymentNonce(chainId: bigint, account: Address): Promise<bigint> {
    const client = getPublicClient(chainId);
    return await client.readContract({
      address: INTEROP_EXECUTOR,
      abi: INTEROP_EXECUTOR_ABI,
      functionName: 'paymentNonce',
      args: [account],
    });
  }

  /**
   * Get token balance and decimals for an account
   */
  async getTokenInfo(
    chainId: bigint,
    tokenAddress: Address,
    account: Address
  ): Promise<{ balance: bigint; decimals: number }> {
    const client = getPublicClient(chainId);

    const [balance, decimals] = await client.multicall({
      contracts: [
        {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        },
        {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        },
      ],
      allowFailure: false,
    });

    return { balance, decimals };
  }

  /**
   * Validate an order by simulating the open contract call
   * Throws an error if the order would fail on-chain
   */
  async validateOrder(order: Order, chainId: bigint): Promise<void> {
    const client = getPublicClient(chainId);

    const isLzOrder = isAddressEqual(
      order.srcIntent.adapter,
      LAYERZERO_ADAPTER
    );

    // For LZ orders, the relayer funds the adapter with native ETH at runtime.
    // Override the adapter's balance so the simulation passes.
    const stateOverride = isLzOrder
      ? [{ address: LAYERZERO_ADAPTER, balance: LZ_DEFAULT_NATIVE_FEE }]
      : undefined;
    await client.simulateContract({
      account: PAYMENT_RECIPIENT_ADDRESS,
      address: INTEROP_EXECUTOR,
      abi: INTEROP_EXECUTOR_ABI,
      functionName: 'open',
      args: [order],
      stateOverride,
    });
  }

  /**
   * Estimate gas for opening an order on the source chain
   * Uses state overrides to set the sender's token balance to srcIntent.amount
   */
  async estimateSrcGas(
    order: Order,
    inputTokens?: { address: Address; amount: bigint }[],
    additionalOverrides?: JsonStateOverride
  ): Promise<{ gasCost: bigint; gasPrice: bigint }> {
    const { srcIntent, sender } = order;
    const chainId = Number(srcIntent.chainId);

    // Build state override to set the sender's token balance
    const srcTokenBalanceSlot = getTokenBalanceSlot(
      chainId,
      srcIntent.token,
      sender
    );

    // overrides with inputTokens if specified
    const stateOverrides: JsonStateOverride = [
      ...(inputTokens
        ? inputTokens.map((token) => {
            const tokenBalanceSlot = getTokenBalanceSlot(
              chainId,
              token.address,
              sender
            );
            return {
              address: token.address,
              stateDiff: [
                {
                  slot: tokenBalanceSlot,
                  value: toHex(token.amount, { size: 32 }),
                },
              ],
            };
          })
        : [
            {
              address: srcIntent.token,
              stateDiff: [
                {
                  slot: srcTokenBalanceSlot,
                  value: toHex(srcIntent.amount, { size: 32 }),
                },
              ],
            },
          ]),
      ...(additionalOverrides ?? []),
    ];

    try {
      const gasEstimate = await relayerClient.estimateGas({
        operation: 'open',
        order: serializeBigInt(order),
        interopExecutor: INTEROP_EXECUTOR,
        stateOverrides,
      });
      return {
        gasCost: BigInt(gasEstimate.gasCost),
        gasPrice: BigInt(gasEstimate.gasPrice),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new GasEstimationError(
        `Failed to estimate gas for open operation: ${message}`,
        chainId,
        error
      );
    }
  }

  /**
   * Get cached event
   */
  private getCachedEvent(key: string): LogWithArgs | null {
    return this.eventCache.get(key) || null;
  }

  /**
   * Set cached event
   */
  private setCachedEvent(key: string, event: LogWithArgs): void {
    this.eventCache.set(key, event);
  }

  /**
   * Get latest block number for a chain
   */
  private async getLatestBlockNumber(chainId: bigint): Promise<bigint> {
    const client = getPublicClient(chainId);
    return await client.getBlockNumber();
  }

  /**
   * Query OrderOpened event by orderHash
   */
  private async queryOrderOpenedEvent(
    orderHash: Hex,
    chainId: bigint,
    interopExecutor?: Address
  ): Promise<LogWithArgs | null> {
    const cacheKey = `opened:${orderHash}`;
    const cached = this.getCachedEvent(cacheKey);
    if (cached) return cached;

    const latestBlock = await this.getLatestBlockNumber(chainId);
    const fromBlock = latestBlock - this.BLOCK_RANGE;

    const logs = (await getPublicClient(chainId).getLogs({
      address: interopExecutor || INTEROP_EXECUTOR,
      event: {
        type: 'event',
        name: 'OrderOpened',
        inputs: [
          { type: 'bytes32', name: 'orderHash', indexed: true },
          { type: 'address', name: 'sender', indexed: true },
          { type: 'uint256', name: 'targetChainId', indexed: true },
        ],
      },
      args: {
        orderHash,
      },
      fromBlock: fromBlock > 0n ? fromBlock : 0n,
      toBlock: 'latest',
    })) as LogWithArgs[];

    const event = logs[0] || null;
    if (event) {
      this.setCachedEvent(cacheKey, event);
    }
    return event;
  }

  /**
   * Query OrderFilled event by orderHash
   */
  private async queryOrderFilledEvent(
    orderHash: Hex,
    chainId: bigint,
    interopExecutor?: Address
  ): Promise<LogWithArgs | null> {
    const cacheKey = `filled:${orderHash}`;
    const cached = this.getCachedEvent(cacheKey);
    if (cached) return cached;

    const latestBlock = await this.getLatestBlockNumber(chainId);
    const fromBlock = latestBlock - this.BLOCK_RANGE;

    const logs = (await getPublicClient(chainId).getLogs({
      address: interopExecutor || INTEROP_EXECUTOR,
      event: {
        type: 'event',
        name: 'OrderFilled',
        inputs: [
          { type: 'bytes32', name: 'orderHash', indexed: true },
          { type: 'address', name: 'sender', indexed: true },
          { type: 'uint256', name: 'srcChainId', indexed: true },
        ],
      },
      args: {
        orderHash,
      },
      fromBlock: fromBlock > 0n ? fromBlock : 0n,
      toBlock: 'latest',
    })) as LogWithArgs[];

    const event = logs[0] || null;
    if (event) {
      this.setCachedEvent(cacheKey, event);
    }
    return event;
  }

  /**
   * Get order open receipt (transaction receipt for OrderOpened event)
   */
  async getOrderOpenReceipt(
    orderHash: Hex,
    chainId: bigint,
    interopExecutor?: Address
  ) {
    const event = await this.queryOrderOpenedEvent(
      orderHash,
      chainId,
      interopExecutor
    );
    if (!event) {
      return null;
    }

    const client = getPublicClient(chainId);
    const receipt = await client.getTransactionReceipt({
      hash: event.transactionHash!,
    });

    return {
      event: {
        orderHash: event.args.orderHash,
        sender: event.args.sender,
        targetChainId: event.args.targetChainId,
      },
      transaction: {
        hash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        from: receipt.from,
        to: receipt.to,
        status: receipt.status,
        gasUsed: receipt.gasUsed,
      },
    };
  }

  /**
   * Get order fill receipt (transaction receipt for OrderFilled event)
   */
  async getOrderFillReceipt(
    orderHash: Hex,
    chainId: bigint,
    interopExecutor?: Address
  ) {
    const event = await this.queryOrderFilledEvent(
      orderHash,
      chainId,
      interopExecutor
    );

    if (!event) {
      return null;
    }

    const client = getPublicClient(chainId);
    const receipt = await client.getTransactionReceipt({
      hash: event.transactionHash!,
    });

    return {
      event: {
        orderHash: event.args.orderHash,
        sender: event.args.sender,
        srcChainId: event.args.srcChainId,
      },
      transaction: {
        hash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        from: receipt.from,
        to: receipt.to,
        status: receipt.status,
        gasUsed: receipt.gasUsed,
      },
    };
  }
}

export const chainService = new ChainService();
