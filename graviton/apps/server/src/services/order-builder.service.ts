import type {
  Order,
  ExecutionCall,
  RouteQuote,
  MultiInputQuoteResponse,
  PaymentToken,
} from '@graviton/core';
import type { Address, Hex } from 'viem';
import { pad, zeroAddress } from 'viem';
import {
  CCTP_ADAPTER,
  BALANCE_VALIDATOR_ADDRESS,
  PAYMENT_RECIPIENT_ADDRESS,
  USDC_ADDRESSES,
  LAYERZERO_ADAPTER,
  LZ_DEFAULT_DST_GAS_LIMIT,
} from '../constants/contracts.js';
import {
  encodeCCTPAdapterData,
  encodeBalanceValidatorData,
  getCCTPDomain,
  encodeExecutionCall,
  encodeLZAdapterData,
  encodeLZOptions,
  getLZEndpointId,
} from '../utils/order.utils.js';
import type { TargetCall } from '../types/index.js';

interface StubOrderParams {
  sender: Address;
  initData: Hex;
  srcChainId: bigint;
  paymentNonce: bigint;
  targetChainId: bigint;
  executionNonce: bigint;
  targetCalls: ExecutionCall[];
  bridgeType: 'CCTP' | 'ACROSS' | 'RELAY';
  routesQuote: RouteQuote[];
}

interface GasOnlySameChainOrderParams {
  sender: Address;
  initData: Hex;
  chainId: bigint;
  paymentNonce: bigint;
  executionNonce: bigint;
  targetCalls: ExecutionCall[];
  paymentTokens: PaymentToken[];
}

interface GasOnlyLZOrderParams {
  sender: Address;
  initData: Hex;
  srcChainId: bigint;
  paymentNonce: bigint;
  targetChainId: bigint;
  executionNonce: bigint;
  targetCalls: ExecutionCall[];
  paymentTokens: PaymentToken[];
}

/**
 * Service for building and processing orders
 */
export class OrderBuilderService {
  /**
   * Create a stub order with placeholder amounts
   * If srcToken and targetToken are different (and srcToken is USDC),
   * fetches swap quote from quoter and prepends swap calls to executions
   */
  createStubOrder(params: StubOrderParams): Order {
    const {
      sender,
      initData,
      srcChainId,
      paymentNonce,
      targetChainId,
      executionNonce,
      targetCalls,
      routesQuote,
    } = params;

    // get target call and amount from routesQuote
    const firstRoute = routesQuote[0];
    if (!firstRoute) {
      throw new Error('No routes quote found');
    }

    const { inputToken, inputAmount, targetToken, targetAmount } =
      this.extractRouteTokens(firstRoute, srcChainId === targetChainId);
    const targetSawapCalls = firstRoute.targetCalls;

    const { adapter, adapterData } = this.getAdapterConfig(
      srcChainId === targetChainId,
      targetChainId
    );

    const currentTime = Math.floor(Date.now() / 1000);
    const openDeadline = currentTime + 300; // 5 minutes
    const fillDeadline = openDeadline + 300; // 10 minutes total

    // Get target token on target chain
    const targetBridgedAddress = this.getTargetToken(
      targetChainId,
      targetToken
    );

    // Set balance validation if cross-chain
    const validations =
      srcChainId === targetChainId
        ? []
        : [
            {
              validator: BALANCE_VALIDATOR_ADDRESS,
              data: encodeBalanceValidatorData(targetAmount),
            },
          ];

    // Combine swap calls with user's target calls
    const swapExecutionCalls =
      targetSawapCalls.length > 0
        ? encodeExecutionCall(firstRoute.targetCalls)
        : [];
    const allExecutionCalls = [...swapExecutionCalls, ...targetCalls];

    return {
      sender,
      openDeadline,
      fillDeadline,
      initData,
      srcIntent: {
        chainId: BigInt(srcChainId),
        nonce: paymentNonce,
        paymentTokens: [
          {
            recipient: PAYMENT_RECIPIENT_ADDRESS,
            token: inputToken,
            amount: 0n,
          },
        ],
        preHooks: [],
        postHooks: [],
        token: inputToken,
        amount: inputAmount,
        adapter,
        adapterData,
      },
      targetIntent: {
        chainId: BigInt(targetChainId),
        nonce: executionNonce,
        token: targetBridgedAddress,
        amount: targetAmount,
        validations,
        executions: allExecutionCalls,
      },
      signature:
        '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c' as Hex,
    };
  }

  /**
   * Create a gas-only LayerZero order that collects payment tokens on the
   * source chain and bridges only a message (amount=0, no token transfer).
   */
  createGasOnlyLZOrder(params: GasOnlyLZOrderParams): Order {
    const {
      sender,
      initData,
      srcChainId,
      paymentNonce,
      targetChainId,
      executionNonce,
      targetCalls,
      paymentTokens,
    } = params;

    const srcUsdcAddress = USDC_ADDRESSES[Number(srcChainId)];
    if (!srcUsdcAddress) {
      throw new Error(`USDC not found for chainId ${srcChainId}`);
    }

    const dstEid = getLZEndpointId(targetChainId);

    const options = encodeLZOptions(LZ_DEFAULT_DST_GAS_LIMIT);

    const adapterData = encodeLZAdapterData({
      dstEid,
      options,
      refundAddress: PAYMENT_RECIPIENT_ADDRESS,
    });

    const currentTime = Math.floor(Date.now() / 1000);
    const openDeadline = currentTime + 300;
    const fillDeadline = openDeadline + 300;

    return {
      sender,
      openDeadline,
      fillDeadline,
      initData,
      srcIntent: {
        chainId: srcChainId,
        nonce: paymentNonce,
        paymentTokens,
        preHooks: [],
        postHooks: [],
        token: srcUsdcAddress,
        amount: 0n,
        adapter: LAYERZERO_ADAPTER,
        adapterData,
      },
      targetIntent: {
        chainId: targetChainId,
        nonce: executionNonce,
        token: USDC_ADDRESSES[Number(targetChainId)]!,
        amount: 0n,
        validations: [],
        executions: targetCalls,
      },
      signature:
        '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c' as Hex,
    };
  }

  /**
   * Create a gas-only same-chain order that collects payment tokens on the
   * source chain without bridging (adapter=zeroAddress, amount=0).
   */
  createGasOnlySameChainOrder(params: GasOnlySameChainOrderParams): Order {
    const {
      sender,
      initData,
      chainId,
      paymentNonce,
      executionNonce,
      targetCalls,
      paymentTokens,
    } = params;

    const usdcAddress = USDC_ADDRESSES[Number(chainId)];
    if (!usdcAddress) {
      throw new Error(`USDC not found for chainId ${chainId}`);
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const openDeadline = currentTime + 300;
    const fillDeadline = openDeadline + 300;

    return {
      sender,
      openDeadline,
      fillDeadline,
      initData,
      srcIntent: {
        chainId,
        nonce: paymentNonce,
        paymentTokens,
        preHooks: [],
        postHooks: [],
        token: usdcAddress,
        amount: 0n,
        adapter: zeroAddress,
        adapterData: '0x',
      },
      targetIntent: {
        chainId,
        nonce: executionNonce,
        token: usdcAddress,
        amount: 0n,
        validations: [],
        executions: targetCalls,
      },
      signature:
        '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c' as Hex,
    };
  }

  /**
   * Build a new order with quote data applied (immutable)
   */
  buildOrderFromQuote(
    order: Order,
    quote: MultiInputQuoteResponse,
    paymentTokens: PaymentToken[],
    targetCalls: TargetCall[]
  ): Order {
    const totalQuoteOutput = quote.details.bridge.outputAmount;

    const isSameChain = order.srcIntent.chainId === order.targetIntent.chainId;

    const { adapter, adapterData } = this.buildAdapterConfig(
      isSameChain,
      order.targetIntent.chainId,
      quote
    );
    return {
      ...order,
      srcIntent: {
        ...order.srcIntent,
        preHooks: quote.approvalCalls.map((call) => ({
          to: call.to,
          data: call.data || '0x',
          value: BigInt(call.value || '0'),
        })),
        token: quote.details.bridge.inputToken.address,
        amount: BigInt(quote.details.bridge.inputAmount),
        paymentTokens,
        adapter,
        adapterData,
      },
      targetIntent: {
        ...order.targetIntent,
        token: quote.details.bridge.outputToken.address,
        amount: totalQuoteOutput,
        executions: [...encodeExecutionCall(quote.targetCalls), ...targetCalls],
      },
    };
  }

  private extractRouteTokens(
    route: RouteQuote,
    isSameChain: boolean
  ): {
    inputToken: Address;
    inputAmount: bigint;
    targetToken: Address;
    targetAmount: bigint;
  } {
    if (isSameChain) {
      return {
        inputToken: route.inputToken,
        inputAmount: BigInt(route.inputAmount),
        targetToken: route.inputToken,
        targetAmount: BigInt(route.inputAmount),
      };
    }

    return {
      inputToken: route.details.bridge.inputToken.address,
      inputAmount: BigInt(route.details.bridge.inputAmount),
      targetToken: route.details.bridge.outputToken.address,
      targetAmount: BigInt(route.details.bridge.outputAmount),
    };
  }

  private getAdapterConfig(
    isSameChain: boolean,
    targetChainId: bigint
  ): { adapter: Address; adapterData: Hex } {
    if (isSameChain) {
      return { adapter: zeroAddress, adapterData: '0x' };
    }

    // TODO: different bridge adapter
    return {
      adapter: CCTP_ADAPTER,
      adapterData: encodeCCTPAdapterData({
        destinationDomain: getCCTPDomain(targetChainId),
        destinationCaller: pad(CCTP_ADAPTER, { size: 32 }),
        maxFee: 30n, // Placeholder, will be updated later
        minFinalityThreshold: 1000,
      }),
    };
  }

  private buildAdapterConfig(
    isSameChain: boolean,
    targetChainId: bigint,
    quote: MultiInputQuoteResponse
  ): { adapter: Address; adapterData: Hex } {
    if (isSameChain) {
      return { adapter: zeroAddress, adapterData: '0x' };
    }

    return {
      adapter: CCTP_ADAPTER,
      adapterData: encodeCCTPAdapterData({
        destinationDomain: getCCTPDomain(targetChainId),
        destinationCaller: pad(CCTP_ADAPTER, { size: 32 }),
        maxFee: BigInt(quote.details.bridge.gasEstimate),
        minFinalityThreshold: 1000,
      }),
    };
  }

  getTargetToken(chainId: bigint, token: Address): Address {
    const targetUsdcAddress = USDC_ADDRESSES[Number(chainId)];
    if (!targetUsdcAddress) {
      throw new Error(`USDC not found for chainId ${chainId}`);
    }
    return targetUsdcAddress || token;
  }
}

export const orderBuilderService = new OrderBuilderService();
