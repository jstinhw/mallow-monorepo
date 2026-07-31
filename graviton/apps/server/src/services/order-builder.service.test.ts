import { describe, it, expect } from 'vitest';
import type {
  Order,
  RouteQuote,
  MultiInputQuoteResponse,
  PaymentToken,
  ExecutionCall,
} from '@graviton/core';
import type { Address, Hex } from 'viem';
import { OrderBuilderService } from './order-builder.service.js';
import {
  CCTP_ADAPTER,
  BALANCE_VALIDATOR_ADDRESS,
  PAYMENT_RECIPIENT_ADDRESS,
  USDC_ADDRESSES,
  LAYERZERO_ADAPTER,
} from '../constants/contracts.js';

// ── Test constants ──────────────────────────────────────────────────────

const SENDER = '0x1234567890123456789012345678901234567890' as Address;
const TOKEN_ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address;
const TOKEN_BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const TOKEN_OP_USDC = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as Address;

// ── Test helpers ────────────────────────────────────────────────────────

function createMockRouteQuote(overrides?: Partial<RouteQuote>): RouteQuote {
  return {
    inputToken: TOKEN_ARB_USDC,
    inputAmount: 1000000n,
    srcCalls: [],
    swapCalls: [],
    targetCalls: [],
    fees: {
      details: [],
    },
    details: {
      bridge: {
        type: 'bridge',
        inputToken: {
          address: TOKEN_ARB_USDC,
          chainId: 42161,
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
        },
        outputToken: {
          address: TOKEN_BASE_USDC,
          chainId: 8453,
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
        },
        inputAmount: 1000000n,
        outputAmount: 990000n,
        gasEstimate: 100000n,
        protocol: 'CCTP',
      },
      swapDestination: [],
    },
    ...overrides,
  } as RouteQuote;
}

function createMockOrder(overrides?: Partial<Order>): Order {
  return {
    sender: SENDER,
    openDeadline: 1000,
    fillDeadline: 2000,
    initData: '0x' as Hex,
    srcIntent: {
      chainId: 42161n,
      nonce: 0n,
      paymentTokens: [],
      preHooks: [],
      postHooks: [],
      token: TOKEN_ARB_USDC,
      amount: 1000000n,
      adapter: CCTP_ADAPTER,
      adapterData: '0x' as Hex,
    },
    targetIntent: {
      chainId: 8453n,
      nonce: 0n,
      token: TOKEN_BASE_USDC,
      amount: 1000000n,
      validations: [],
      executions: [],
    },
    signature:
      '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c' as Hex,
    ...overrides,
  };
}

function createMockMultiInputQuote(
  overrides?: Partial<MultiInputQuoteResponse>
): MultiInputQuoteResponse {
  return {
    id: 'quote-1',
    inputTokens: [{ address: TOKEN_ARB_USDC, amount: 1000000n }],
    outputTokens: [{ address: TOKEN_BASE_USDC, amount: 990000n }],
    approvalCalls: [],
    swapCalls: [],
    targetCalls: [
      {
        to: '0x0000000000000000000000000000000000000001' as Address,
        value: 0n,
        data: '0xabc' as Hex,
      },
    ],
    fees: { details: [] },
    details: {
      swapOrigin: [],
      bridge: {
        type: 'bridge',
        inputToken: {
          address: TOKEN_ARB_USDC,
          chainId: 42161,
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
        },
        outputToken: {
          address: TOKEN_BASE_USDC,
          chainId: 8453,
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
        },
        inputAmount: 1000000n,
        outputAmount: 990000n,
        gasEstimate: 100000n,
        protocol: 'CCTP',
      },
      swapDestination: [],
    },
    ...overrides,
  } as MultiInputQuoteResponse;
}

function baseStubParams() {
  return {
    sender: SENDER,
    initData: '0x1234' as Hex,
    srcChainId: 42161n,
    paymentNonce: 5n,
    targetChainId: 8453n,
    executionNonce: 10n,
    targetCalls: [] as ExecutionCall[],
    bridgeType: 'CCTP' as const,
    routesQuote: [createMockRouteQuote()],
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('OrderBuilderService', () => {
  const service = new OrderBuilderService();

  describe('createStubOrder', () => {
    it('creates an order with correct sender and initData', () => {
      const order = service.createStubOrder(baseStubParams());

      expect(order.sender).toBe(SENDER);
      expect(order.initData).toBe('0x1234');
    });

    it('sets srcIntent fields from first route', () => {
      const order = service.createStubOrder(baseStubParams());

      expect(order.srcIntent.chainId).toBe(42161n);
      expect(order.srcIntent.nonce).toBe(5n);
      expect(order.srcIntent.token).toBe(TOKEN_ARB_USDC);
      expect(order.srcIntent.amount).toBe(1000000n);
    });

    it('sets targetIntent fields from first route', () => {
      const order = service.createStubOrder(baseStubParams());

      expect(order.targetIntent.chainId).toBe(8453n);
      expect(order.targetIntent.nonce).toBe(10n);
      expect(order.targetIntent.amount).toBe(990000n);
    });

    it('sets CCTP adapter and encoded adapter data', () => {
      const order = service.createStubOrder(baseStubParams());

      expect(order.srcIntent.adapter).toBe(CCTP_ADAPTER);
      expect(order.srcIntent.adapterData).toBeDefined();
      expect((order.srcIntent.adapterData as string).startsWith('0x')).toBe(
        true
      );
    });

    it('sets payment token with PAYMENT_RECIPIENT_ADDRESS and zero amount', () => {
      const order = service.createStubOrder(baseStubParams());

      expect(order.srcIntent.paymentTokens).toHaveLength(1);
      expect(order.srcIntent.paymentTokens[0]!.recipient).toBe(
        PAYMENT_RECIPIENT_ADDRESS
      );
      expect(order.srcIntent.paymentTokens[0]!.token).toBe(TOKEN_ARB_USDC);
      expect(order.srcIntent.paymentTokens[0]!.amount).toBe(0n);
    });

    it('sets deadlines relative to current time', () => {
      const before = Math.floor(Date.now() / 1000);
      const order = service.createStubOrder(baseStubParams());
      const after = Math.floor(Date.now() / 1000);

      expect(order.openDeadline).toBeGreaterThanOrEqual(before + 300);
      expect(order.openDeadline).toBeLessThanOrEqual(after + 300);
      expect(order.fillDeadline).toBe(order.openDeadline + 300);
    });

    it('initializes preHooks and postHooks as empty arrays', () => {
      const order = service.createStubOrder(baseStubParams());

      expect(order.srcIntent.preHooks).toEqual([]);
      expect(order.srcIntent.postHooks).toEqual([]);
    });

    it('sets balance validation on targetIntent', () => {
      const order = service.createStubOrder(baseStubParams());

      expect(order.targetIntent.validations).toHaveLength(1);
      expect(order.targetIntent.validations[0]!.validator).toBe(
        BALANCE_VALIDATOR_ADDRESS
      );
      expect(order.targetIntent.validations[0]!.data).toBeDefined();
    });

    it('sets placeholder signature', () => {
      const order = service.createStubOrder(baseStubParams());

      expect(order.signature).toBe(
        '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c'
      );
    });

    it('throws when routesQuote is empty', () => {
      const params = { ...baseStubParams(), routesQuote: [] };

      expect(() => service.createStubOrder(params)).toThrow(
        'No routes quote found'
      );
    });

    it('uses target token mapped to USDC on target chain', () => {
      const order = service.createStubOrder(baseStubParams());

      expect(order.targetIntent.token).toBe(USDC_ADDRESSES[8453]);
    });

    it('includes no swap execution calls when route has no targetCalls', () => {
      const params = baseStubParams();
      params.routesQuote = [createMockRouteQuote({ targetCalls: [] })];

      const order = service.createStubOrder(params);

      expect(order.targetIntent.executions).toHaveLength(0);
    });

    it('prepends encoded swap calls when route has targetCalls', () => {
      const params = baseStubParams();
      params.routesQuote = [
        createMockRouteQuote({
          targetCalls: [
            {
              to: '0x0000000000000000000000000000000000000001' as Address,
              value: 0n,
              data: '0xswap' as Hex,
            },
          ],
        }),
      ];

      const order = service.createStubOrder(params);

      expect(order.targetIntent.executions.length).toBeGreaterThanOrEqual(1);
      expect(order.targetIntent.executions[0]!.data).toBeDefined();
      expect(order.targetIntent.executions[0]!.mode).toBeDefined();
    });

    it('appends user targetCalls after swap calls', () => {
      const userCall: ExecutionCall = {
        data: '0xuser' as Hex,
        mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      };
      const params = baseStubParams();
      params.targetCalls = [userCall];

      const order = service.createStubOrder(params);

      const lastExecution =
        order.targetIntent.executions[order.targetIntent.executions.length - 1];
      expect(lastExecution).toEqual(userCall);
    });

    it('works with Optimism as target chain', () => {
      const params = { ...baseStubParams(), targetChainId: 10n };

      const order = service.createStubOrder(params);

      expect(order.targetIntent.chainId).toBe(10n);
      expect(order.targetIntent.token).toBe(USDC_ADDRESSES[10]);
    });
  });

  describe('buildOrderFromQuote', () => {
    it('returns a new order without mutating the original', () => {
      const order = createMockOrder();
      const originalToken = order.srcIntent.token;
      const quote = createMockMultiInputQuote();

      const result = service.buildOrderFromQuote(order, quote, [], []);

      expect(result).not.toBe(order);
      expect(order.srcIntent.token).toBe(originalToken);
    });

    it('sets srcIntent fields from quote bridge details', () => {
      const order = createMockOrder();
      const quote = createMockMultiInputQuote();

      const result = service.buildOrderFromQuote(order, quote, [], []);

      expect(result.srcIntent.token).toBe(TOKEN_ARB_USDC);
      expect(result.srcIntent.amount).toBe(1000000n);
    });

    it('sets targetIntent token and bridge output amount', () => {
      const order = createMockOrder();
      const quote = createMockMultiInputQuote({
        outputTokens: [
          { address: TOKEN_BASE_USDC, amount: 500000n },
          { address: TOKEN_BASE_USDC, amount: 400000n },
        ],
      });

      const result = service.buildOrderFromQuote(order, quote, [], []);

      expect(result.targetIntent.token).toBe(TOKEN_BASE_USDC);
      expect(result.targetIntent.amount).toBe(990000n);
    });

    it('applies payment tokens to srcIntent', () => {
      const order = createMockOrder();
      const quote = createMockMultiInputQuote();
      const paymentTokens: PaymentToken[] = [
        {
          recipient: '0xE0fB05154Ea1d255e49655b6599E0057890189eF' as Address,
          token: TOKEN_ARB_USDC,
          amount: 5000n,
        },
      ];

      const result = service.buildOrderFromQuote(
        order,
        quote,
        paymentTokens,
        []
      );

      expect(result.srcIntent.paymentTokens).toBe(paymentTokens);
    });

    it('maps approval calls to preHooks', () => {
      const order = createMockOrder();
      const quote = createMockMultiInputQuote({
        approvalCalls: [
          {
            to: '0x0000000000000000000000000000000000000002' as Address,
            value: 0n,
            data: '0xapprove' as Hex,
          },
        ],
      });

      const result = service.buildOrderFromQuote(order, quote, [], []);

      expect(result.srcIntent.preHooks).toHaveLength(1);
      expect(result.srcIntent.preHooks[0]!.to).toBe(
        '0x0000000000000000000000000000000000000002'
      );
      expect(result.srcIntent.preHooks[0]!.data).toBe('0xapprove');
      expect(result.srcIntent.preHooks[0]!.value).toBe(0n);
    });

    it('defaults missing call data and value', () => {
      const order = createMockOrder();
      const quote = createMockMultiInputQuote({
        approvalCalls: [
          {
            to: '0x0000000000000000000000000000000000000003' as Address,
          } as any,
        ],
      });

      const result = service.buildOrderFromQuote(order, quote, [], []);

      expect(result.srcIntent.preHooks[0]!.data).toBe('0x');
      expect(result.srcIntent.preHooks[0]!.value).toBe(0n);
    });

    it('encodes targetCalls and appends user targetCalls to executions', () => {
      const order = createMockOrder();
      const quote = createMockMultiInputQuote();
      const userCall = {
        data: '0xuser' as Hex,
        mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      };

      const result = service.buildOrderFromQuote(order, quote, [], [userCall]);

      expect(result.targetIntent.executions).toHaveLength(2);
      expect(result.targetIntent.executions[1]).toEqual(userCall);
    });

    it('preserves unmodified order fields', () => {
      const order = createMockOrder();
      const quote = createMockMultiInputQuote();

      const result = service.buildOrderFromQuote(order, quote, [], []);

      expect(result.sender).toBe(order.sender);
      expect(result.openDeadline).toBe(order.openDeadline);
      expect(result.fillDeadline).toBe(order.fillDeadline);
      expect(result.initData).toBe(order.initData);
      expect(result.srcIntent.chainId).toBe(order.srcIntent.chainId);
      expect(result.srcIntent.nonce).toBe(order.srcIntent.nonce);
      expect(result.srcIntent.postHooks).toEqual(order.srcIntent.postHooks);
      expect(result.targetIntent.chainId).toBe(order.targetIntent.chainId);
      expect(result.targetIntent.nonce).toBe(order.targetIntent.nonce);
    });
  });

  describe('getTargetToken', () => {
    it('returns USDC address for Arbitrum', () => {
      expect(service.getTargetToken(42161n, TOKEN_ARB_USDC)).toBe(
        USDC_ADDRESSES[42161]
      );
    });

    it('returns USDC address for Base', () => {
      expect(service.getTargetToken(8453n, TOKEN_BASE_USDC)).toBe(
        USDC_ADDRESSES[8453]
      );
    });

    it('returns USDC address for Optimism', () => {
      expect(service.getTargetToken(10n, TOKEN_OP_USDC)).toBe(
        USDC_ADDRESSES[10]
      );
    });

    it('returns USDC address for Ethereum mainnet', () => {
      const mainnetUsdc =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
      expect(service.getTargetToken(1n, mainnetUsdc)).toBe(USDC_ADDRESSES[1]);
    });

    it('throws for unsupported chain', () => {
      expect(() => service.getTargetToken(999n, TOKEN_ARB_USDC)).toThrow(
        'USDC not found for chainId 999'
      );
    });
  });

  describe('createGasOnlyLZOrder', () => {
    const baseGasOnlyParams = () => ({
      sender: SENDER,
      initData: '0x1234' as Hex,
      srcChainId: 42161n,
      paymentNonce: 5n,
      targetChainId: 8453n,
      executionNonce: 10n,
      targetCalls: [] as ExecutionCall[],
      paymentTokens: [
        {
          recipient: PAYMENT_RECIPIENT_ADDRESS,
          token: TOKEN_ARB_USDC,
          amount: 50000n,
        },
      ],
    });

    it('creates an order with amount=0 for message-only bridging', () => {
      const order = service.createGasOnlyLZOrder(baseGasOnlyParams());

      expect(order.srcIntent.amount).toBe(0n);
      expect(order.targetIntent.amount).toBe(0n);
    });

    it('uses LayerZero adapter', () => {
      const order = service.createGasOnlyLZOrder(baseGasOnlyParams());

      expect(order.srcIntent.adapter).toBe(LAYERZERO_ADAPTER);
    });

    it('sets USDC as src token (functionally irrelevant but must be valid ERC20)', () => {
      const order = service.createGasOnlyLZOrder(baseGasOnlyParams());

      expect(order.srcIntent.token).toBe(USDC_ADDRESSES[42161]);
    });

    it('sets empty validations on targetIntent', () => {
      const order = service.createGasOnlyLZOrder(baseGasOnlyParams());

      expect(order.targetIntent.validations).toEqual([]);
    });

    it('has empty preHooks', () => {
      const order = service.createGasOnlyLZOrder(baseGasOnlyParams());

      expect(order.srcIntent.preHooks).toEqual([]);
    });

    it('applies payment tokens to srcIntent', () => {
      const order = service.createGasOnlyLZOrder(baseGasOnlyParams());

      expect(order.srcIntent.paymentTokens).toHaveLength(1);
      expect(order.srcIntent.paymentTokens[0]!.amount).toBe(50000n);
    });

    it('encodes LZ adapter data', () => {
      const order = service.createGasOnlyLZOrder(baseGasOnlyParams());

      expect(order.srcIntent.adapterData).toBeDefined();
      expect((order.srcIntent.adapterData as string).startsWith('0x')).toBe(
        true
      );
      expect((order.srcIntent.adapterData as string).length).toBeGreaterThan(2);
    });

    it('sets correct chain IDs', () => {
      const order = service.createGasOnlyLZOrder(baseGasOnlyParams());

      expect(order.srcIntent.chainId).toBe(42161n);
      expect(order.targetIntent.chainId).toBe(8453n);
    });

    it('sets correct nonces', () => {
      const order = service.createGasOnlyLZOrder(baseGasOnlyParams());

      expect(order.srcIntent.nonce).toBe(5n);
      expect(order.targetIntent.nonce).toBe(10n);
    });

    it('throws for unsupported source chain', () => {
      expect(() =>
        service.createGasOnlyLZOrder({
          ...baseGasOnlyParams(),
          srcChainId: 999n,
        })
      ).toThrow('USDC not found for chainId 999');
    });

    it('assigns targetCalls to targetIntent executions', () => {
      const userCall: ExecutionCall = {
        data: '0xuser' as Hex,
        mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      };

      const order = service.createGasOnlyLZOrder({
        ...baseGasOnlyParams(),
        targetCalls: [userCall],
      });

      expect(order.targetIntent.executions).toEqual([userCall]);
    });
  });

  describe('createGasOnlySameChainOrder', () => {
    const baseGasOnlySameChainParams = () => ({
      sender: SENDER,
      initData: '0x1234' as Hex,
      chainId: 42161n,
      paymentNonce: 5n,
      executionNonce: 10n,
      targetCalls: [] as ExecutionCall[],
      paymentTokens: [
        {
          recipient: PAYMENT_RECIPIENT_ADDRESS,
          token: TOKEN_ARB_USDC,
          amount: 50000n,
        },
      ],
    });

    it('creates an order with amount=0 on both intents', () => {
      const order = service.createGasOnlySameChainOrder(
        baseGasOnlySameChainParams()
      );

      expect(order.srcIntent.amount).toBe(0n);
      expect(order.targetIntent.amount).toBe(0n);
    });

    it('uses zeroAddress adapter and 0x adapterData', () => {
      const order = service.createGasOnlySameChainOrder(
        baseGasOnlySameChainParams()
      );

      expect(order.srcIntent.adapter).toBe(
        '0x0000000000000000000000000000000000000000'
      );
      expect(order.srcIntent.adapterData).toBe('0x');
    });

    it('sets same chainId on both intents', () => {
      const order = service.createGasOnlySameChainOrder(
        baseGasOnlySameChainParams()
      );

      expect(order.srcIntent.chainId).toBe(42161n);
      expect(order.targetIntent.chainId).toBe(42161n);
    });

    it('sets empty validations on targetIntent', () => {
      const order = service.createGasOnlySameChainOrder(
        baseGasOnlySameChainParams()
      );

      expect(order.targetIntent.validations).toEqual([]);
    });

    it('applies payment tokens to srcIntent', () => {
      const order = service.createGasOnlySameChainOrder(
        baseGasOnlySameChainParams()
      );

      expect(order.srcIntent.paymentTokens).toHaveLength(1);
      expect(order.srcIntent.paymentTokens[0]!.amount).toBe(50000n);
    });

    it('sets correct nonces', () => {
      const order = service.createGasOnlySameChainOrder(
        baseGasOnlySameChainParams()
      );

      expect(order.srcIntent.nonce).toBe(5n);
      expect(order.targetIntent.nonce).toBe(10n);
    });

    it('throws for unsupported chain', () => {
      expect(() =>
        service.createGasOnlySameChainOrder({
          ...baseGasOnlySameChainParams(),
          chainId: 999n,
        })
      ).toThrow('USDC not found for chainId 999');
    });

    it('assigns targetCalls to targetIntent executions', () => {
      const userCall: ExecutionCall = {
        data: '0xuser' as Hex,
        mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      };

      const order = service.createGasOnlySameChainOrder({
        ...baseGasOnlySameChainParams(),
        targetCalls: [userCall],
      });

      expect(order.targetIntent.executions).toEqual([userCall]);
    });

    it('has empty preHooks and postHooks', () => {
      const order = service.createGasOnlySameChainOrder(
        baseGasOnlySameChainParams()
      );

      expect(order.srcIntent.preHooks).toEqual([]);
      expect(order.srcIntent.postHooks).toEqual([]);
    });
  });
});
