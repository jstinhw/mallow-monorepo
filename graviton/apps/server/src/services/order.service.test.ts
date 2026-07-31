import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Address, Hex } from 'viem';
import type {
  Order,
  TokenWithAmount,
  RouteQuote,
  MultiInputQuoteResponse,
  PaymentToken,
} from '@graviton/core';

// ── Mock modules ────────────────────────────────────────────────────────

vi.mock('../queue/publisher.js', () => ({
  queuePublisher: {
    publishOrder: vi.fn(),
  },
}));

vi.mock('./chain.service.js', () => ({
  chainService: {
    getGasPrice: vi.fn(),
    getExecutionNonce: vi.fn(),
    getPaymentNonce: vi.fn(),
    getTokenInfo: vi.fn(),
    validateOrder: vi.fn(),
    estimateSrcGas: vi.fn(),
    getOrderOpenReceipt: vi.fn(),
    getOrderFillReceipt: vi.fn(),
  },
}));

vi.mock('./order-builder.service.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./order-builder.service.js')>();
  const realInstance = new actual.OrderBuilderService();
  return {
    ...actual,
    orderBuilderService: {
      createStubOrder: vi.fn(),
      buildOrderFromQuote: vi.fn(
        realInstance.buildOrderFromQuote.bind(realInstance)
      ),
      createGasOnlyLZOrder: vi.fn(),
      createGasOnlySameChainOrder: vi.fn(),
    },
  };
});

vi.mock('./clients/quoter.client.js', () => ({
  quoterClient: {
    getQuoteMultiInput: vi.fn(),
    getSwapRoute: vi.fn(),
  },
}));

vi.mock('@graviton/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@graviton/core')>();
  return {
    ...actual,
    convertTokenAmount: vi.fn(),
  };
});

vi.mock('../utils/order.utils.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../utils/order.utils.js')>();
  return {
    ...actual,
    encodeExecutionCall: vi.fn().mockReturnValue([
      {
        data: '0xencoded' as Hex,
        mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      },
    ]),
  };
});

vi.mock('../constants/contracts.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../constants/contracts.js')>();
  return {
    ...actual,
    FEE_RECIPIENT_ADDRESS:
      '0xE0fB05154Ea1d255e49655b6599E0057890189eF' as Address,
  };
});

// ── Imports (after mocks) ───────────────────────────────────────────────

import {
  OrderService,
  collectInputTokensForQuote,
  isEnoughOutputTokens,
  computeUnfilledOutputTokens,
  mergeOutputTokens,
  subtractOutputTokens,
  buildSameChainCumulativeGroups,
  buildCrossChainGroups,
} from './order.service.js';
import type { SrcToken } from '../types/index.js';
import { chainService } from './chain.service.js';
import { orderBuilderService } from './order-builder.service.js';
import { quoterClient } from './clients/quoter.client.js';
import { queuePublisher } from '../queue/publisher.js';
import { convertTokenAmount } from '@graviton/core';
import {
  GasOnlyInsufficientFundsError,
  InsufficientOutputError,
} from '../errors/index.js';
import { LAYERZERO_ADAPTER } from '../constants/contracts.js';

// ── Test constants ──────────────────────────────────────────────────────

const SENDER = '0x1234567890123456789012345678901234567890' as Address;
const TOKEN_A = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address;
const TOKEN_B = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const TOKEN_C = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as Address;
const ADAPTER = '0xc0f3519181e52793ff65286fF00D3b43907A7913' as Address;
const FEE_RECIPIENT = '0xE0fB05154Ea1d255e49655b6599E0057890189eF' as Address;

// ── Test helpers ────────────────────────────────────────────────────────

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
      token: TOKEN_A,
      amount: 1000000n,
      adapter: ADAPTER,
      adapterData: '0x' as Hex,
    },
    targetIntent: {
      chainId: 8453n,
      nonce: 0n,
      token: TOKEN_B,
      amount: 1000000n,
      validations: [],
      executions: [],
    },
    signature:
      '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c' as Hex,
    ...overrides,
  };
}

function createMockRouteQuote(overrides?: Partial<RouteQuote>): RouteQuote {
  return {
    inputToken: TOKEN_A,
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
          address: TOKEN_A,
          chainId: 42161,
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
        },
        outputToken: {
          address: TOKEN_B,
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

function createMockMultiInputQuote(
  overrides?: Partial<MultiInputQuoteResponse>
): MultiInputQuoteResponse {
  return {
    id: 'quote-1',
    inputTokens: [{ address: TOKEN_A, amount: 1000000n }],
    outputTokens: [{ address: TOKEN_B, amount: 990000n }],
    approvalCalls: [],
    swapCalls: [],
    targetCalls: [
      {
        to: '0x0000000000000000000000000000000000000001' as Address,
        value: 0n,
        data: '0x' as Hex,
      },
    ],
    fees: {
      details: [],
    },
    details: {
      swapOrigin: [],
      bridge: {
        type: 'bridge',
        inputToken: {
          address: TOKEN_A,
          chainId: 42161,
          name: 'USDC',
          symbol: 'USDC',
          decimals: 6,
        },
        outputToken: {
          address: TOKEN_B,
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

// ── Pure function tests ─────────────────────────────────────────────────

describe('collectInputTokensForQuote', () => {
  const chainTokens: TokenWithAmount[] = [
    { address: TOKEN_A, amount: 1000n },
    { address: TOKEN_B, amount: 2000n },
  ];
  const srcChainId = 42161n;
  const gasPrice = 1n; // simple gas price
  const srcGas = 100n; // base gas

  beforeEach(() => {
    vi.mocked(convertTokenAmount).mockImplementation(
      async (_chainId, _from, _to, amount) => amount // 1:1 conversion for simplicity
    );
  });

  it('returns only current token for first route (routeIdx=0)', async () => {
    const routes = [
      createMockRouteQuote({ inputToken: TOKEN_A }),
      createMockRouteQuote({ inputToken: TOKEN_B }),
    ];

    const { inputTokens, paymentTokens } = await collectInputTokensForQuote(
      routes,
      0,
      chainTokens,
      srcGas,
      gasPrice,
      srcChainId
    );

    expect(inputTokens).toHaveLength(1);
    expect(inputTokens[0]!.address).toBe(TOKEN_A);
    expect(inputTokens[0]!.amount).toBe(900n); // 1000 - 100 gas

    expect(paymentTokens).toHaveLength(1);
    expect(paymentTokens[0]!.token).toBe(TOKEN_A);
    expect(paymentTokens[0]!.amount).toBe(100n);
  });

  it('collects previous route tokens for subsequent routes', async () => {
    const routes = [
      createMockRouteQuote({ inputToken: TOKEN_A }),
      createMockRouteQuote({ inputToken: TOKEN_B }),
    ];

    const { inputTokens, paymentTokens } = await collectInputTokensForQuote(
      routes,
      1,
      chainTokens,
      srcGas, // 100n, paid by first token
      gasPrice,
      srcChainId
    );

    expect(inputTokens).toHaveLength(2);
    // Token A pays gas (100)
    expect(inputTokens[0]!.address).toBe(TOKEN_A);
    expect(inputTokens[0]!.amount).toBe(900n);
    // Token B untouched by gas
    expect(inputTokens[1]!.address).toBe(TOKEN_B);
    expect(inputTokens[1]!.amount).toBe(2000n);

    expect(paymentTokens).toHaveLength(1);
    expect(paymentTokens[0]!.token).toBe(TOKEN_A);
    expect(paymentTokens[0]!.amount).toBe(100n);
  });

  it('handles swap fees correctly', async () => {
    const routes = [
      createMockRouteQuote({
        inputToken: TOKEN_A,
        fees: {
          details: [
            {
              type: 'swap',
              token: {
                chainId: Number(srcChainId),
                address: TOKEN_A,
                decimals: 6,
                symbol: 'USDC',
                name: 'USDC',
              },
              amount: 50n,
            },
          ],
        },
      }),
    ];

    const { inputTokens, paymentTokens } = await collectInputTokensForQuote(
      routes,
      0,
      chainTokens,
      150n,
      gasPrice,
      srcChainId
    );

    // swapFee = 50. remainingGas = 150 - 50 = 100.
    // available = 1000.
    // pays 50 swapFee. available = 950.
    // pays 100 gas. available = 850.

    expect(inputTokens[0]!.amount).toBe(800n);
    expect(paymentTokens[0]!.amount).toBe(200n); // 150 gas + 50 swap
  });

  it('returns empty when gas exceeds balance', async () => {
    const routes = [createMockRouteQuote({ inputToken: TOKEN_A })];

    const { inputTokens } = await collectInputTokensForQuote(
      routes,
      0,
      chainTokens,
      1000n, // gas equals balance
      gasPrice,
      srcChainId
    );

    // If gas == balance, inputToken is 0, so it's not pushed.
    expect(inputTokens).toHaveLength(0);
  });

  it('splits gas payment across multiple tokens if needed', async () => {
    const routes = [
      createMockRouteQuote({ inputToken: TOKEN_A }),
      createMockRouteQuote({ inputToken: TOKEN_B }),
    ];

    // Gas = 1500. Token A has 1000. Token B has 2000.
    const { inputTokens, paymentTokens } = await collectInputTokensForQuote(
      routes,
      1,
      chainTokens,
      1500n,
      gasPrice,
      srcChainId
    );

    // Token A: pays 1000. Remaining gas 500. Input 0.
    // Token B: pays 500. Remaining gas 0. Input 1500.

    expect(inputTokens).toHaveLength(1);
    expect(inputTokens[0]!.address).toBe(TOKEN_B);
    expect(inputTokens[0]!.amount).toBe(1500n);

    expect(paymentTokens).toHaveLength(2);
    expect(paymentTokens[0]!.token).toBe(TOKEN_A);
    expect(paymentTokens[0]!.amount).toBe(1000n);
    expect(paymentTokens[1]!.token).toBe(TOKEN_B);
    expect(paymentTokens[1]!.amount).toBe(500n);
  });

  it('skips tokens that cannot afford swap fees', async () => {
    const routes = [
      createMockRouteQuote({
        inputToken: TOKEN_A,
        fees: {
          details: [
            {
              type: 'swap',
              token: {
                chainId: Number(srcChainId),
                address: TOKEN_A,
                decimals: 6,
                symbol: 'USDC',
                name: 'USDC',
              },
              amount: 1500n, // Fee > Balance (1000)
            },
          ],
        },
      }),
      createMockRouteQuote({ inputToken: TOKEN_B }),
    ];

    const { inputTokens, paymentTokens } = await collectInputTokensForQuote(
      routes,
      1,
      chainTokens,
      100n,
      gasPrice,
      srcChainId
    );

    // Token A skipped because 1000 < 1500.
    // Token B pays gas (100). Remaining 1900.

    expect(inputTokens).toHaveLength(1);
    expect(inputTokens[0]!.address).toBe(TOKEN_B);
    expect(inputTokens[0]!.amount).toBe(1900n);

    expect(paymentTokens).toHaveLength(1);
    expect(paymentTokens[0]!.token).toBe(TOKEN_B);
    expect(paymentTokens[0]!.amount).toBe(100n);
  });
});

describe('buildOrderFromQuote', () => {
  it('returns a new order with quote data applied', () => {
    const order = createMockOrder();
    const quote = createMockMultiInputQuote();
    const paymentTokens: PaymentToken[] = [
      { recipient: FEE_RECIPIENT, token: TOKEN_A, amount: 500n },
    ];
    const targetCalls = [
      {
        data: '0xcall' as Hex,
        mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      },
    ];

    const result = orderBuilderService.buildOrderFromQuote(
      order,
      quote,
      paymentTokens,
      targetCalls
    );

    expect(result).not.toBe(order);
    expect(result.srcIntent.token).toBe(TOKEN_A);
    expect(result.srcIntent.amount).toBe(1000000n);
    expect(result.srcIntent.paymentTokens).toBe(paymentTokens);
    expect(result.targetIntent.token).toBe(TOKEN_B);
    expect(result.targetIntent.amount).toBe(990000n);
    expect(result.targetIntent.executions).toHaveLength(2);
  });

  it('does not mutate the original order', () => {
    const order = createMockOrder();
    const originalToken = order.srcIntent.token;
    const quote = createMockMultiInputQuote();

    orderBuilderService.buildOrderFromQuote(order, quote, [], []);

    expect(order.srcIntent.token).toBe(originalToken);
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

    const result = orderBuilderService.buildOrderFromQuote(
      order,
      quote,
      [],
      []
    );

    expect(result.srcIntent.preHooks).toHaveLength(1);
    expect(result.srcIntent.preHooks[0]!.to).toBe(
      '0x0000000000000000000000000000000000000002'
    );
    expect(result.srcIntent.preHooks[0]!.data).toBe('0xapprove');
  });

  it('uses bridge output amount for targetIntent', () => {
    const order = createMockOrder();
    const quote = createMockMultiInputQuote({
      outputTokens: [
        { address: TOKEN_B, amount: 500000n },
        { address: TOKEN_B, amount: 300000n },
      ],
    });

    const result = orderBuilderService.buildOrderFromQuote(
      order,
      quote,
      [],
      []
    );

    expect(result.targetIntent.amount).toBe(990000n);
  });

  it('preserves unmodified order fields', () => {
    const order = createMockOrder();
    const quote = createMockMultiInputQuote();

    const result = orderBuilderService.buildOrderFromQuote(
      order,
      quote,
      [],
      []
    );

    expect(result.sender).toBe(order.sender);
    expect(result.openDeadline).toBe(order.openDeadline);
    expect(result.fillDeadline).toBe(order.fillDeadline);
    expect(result.srcIntent.chainId).toBe(order.srcIntent.chainId);
    expect(result.targetIntent.chainId).toBe(order.targetIntent.chainId);
  });
});

describe('computeUnfilledOutputTokens', () => {
  it('returns tokens with remaining amounts', () => {
    const target = new Map<Address, bigint>([[TOKEN_A, 1000n]]);
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 600n]]);

    const result = computeUnfilledOutputTokens(target, accumulated);

    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe(TOKEN_A);
    expect(result[0]!.amount).toBe(400n);
  });

  it('filters out fully met tokens', () => {
    const target = new Map<Address, bigint>([
      [TOKEN_A, 1000n],
      [TOKEN_B, 500n],
    ]);
    const accumulated = new Map<Address, bigint>([
      [TOKEN_A, 1000n],
      [TOKEN_B, 200n],
    ]);

    const result = computeUnfilledOutputTokens(target, accumulated);

    expect(result).toHaveLength(1);
    expect(result[0]!.address).toBe(TOKEN_B);
    expect(result[0]!.amount).toBe(300n);
  });

  it('returns all tokens when nothing accumulated', () => {
    const target = new Map<Address, bigint>([
      [TOKEN_A, 1000n],
      [TOKEN_B, 500n],
    ]);
    const accumulated = new Map<Address, bigint>();

    const result = computeUnfilledOutputTokens(target, accumulated);

    expect(result).toHaveLength(2);
  });

  it('returns empty when all targets met', () => {
    const target = new Map<Address, bigint>([[TOKEN_A, 1000n]]);
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 1500n]]);

    const result = computeUnfilledOutputTokens(target, accumulated);

    expect(result).toHaveLength(0);
  });
});

describe('mergeOutputTokens', () => {
  it('adds new tokens to empty map', () => {
    const accumulated = new Map<Address, bigint>();
    const outputTokens = [{ address: TOKEN_A, amount: 500n }];

    const result = mergeOutputTokens(accumulated, outputTokens);

    expect(result.get(TOKEN_A)).toBe(500n);
  });

  it('sums amounts for existing tokens', () => {
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 300n]]);
    const outputTokens = [{ address: TOKEN_A, amount: 200n }];

    const result = mergeOutputTokens(accumulated, outputTokens);

    expect(result.get(TOKEN_A)).toBe(500n);
  });

  it('handles mix of new and existing tokens', () => {
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 100n]]);
    const outputTokens = [
      { address: TOKEN_A, amount: 50n },
      { address: TOKEN_B, amount: 200n },
    ];

    const result = mergeOutputTokens(accumulated, outputTokens);

    expect(result.get(TOKEN_A)).toBe(150n);
    expect(result.get(TOKEN_B)).toBe(200n);
  });

  it('does not mutate the original map', () => {
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 100n]]);
    const outputTokens = [{ address: TOKEN_A, amount: 50n }];

    const result = mergeOutputTokens(accumulated, outputTokens);

    expect(result).not.toBe(accumulated);
    expect(accumulated.get(TOKEN_A)).toBe(100n);
  });

  it('preserves unaffected tokens', () => {
    const accumulated = new Map<Address, bigint>([
      [TOKEN_A, 100n],
      [TOKEN_B, 200n],
    ]);
    const outputTokens = [{ address: TOKEN_A, amount: 50n }];

    const result = mergeOutputTokens(accumulated, outputTokens);

    expect(result.get(TOKEN_A)).toBe(150n);
    expect(result.get(TOKEN_B)).toBe(200n);
  });
});

describe('subtractOutputTokens', () => {
  it('subtracts amounts correctly', () => {
    const accumulated = new Map<Address, bigint>([
      [TOKEN_A, 1000n],
      [TOKEN_B, 500n],
    ]);
    const outputTokens = [{ address: TOKEN_A, amount: 300n }];

    const result = subtractOutputTokens(accumulated, outputTokens);

    expect(result.get(TOKEN_A)).toBe(700n);
    expect(result.get(TOKEN_B)).toBe(500n);
  });

  it('removes entries that reach zero', () => {
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 500n]]);
    const outputTokens = [{ address: TOKEN_A, amount: 500n }];

    const result = subtractOutputTokens(accumulated, outputTokens);

    expect(result.has(TOKEN_A)).toBe(false);
  });

  it('removes entries that go negative', () => {
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 300n]]);
    const outputTokens = [{ address: TOKEN_A, amount: 500n }];

    const result = subtractOutputTokens(accumulated, outputTokens);

    expect(result.has(TOKEN_A)).toBe(false);
  });

  it('does not mutate the original map', () => {
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 1000n]]);
    const outputTokens = [{ address: TOKEN_A, amount: 300n }];

    const result = subtractOutputTokens(accumulated, outputTokens);

    expect(result).not.toBe(accumulated);
    expect(accumulated.get(TOKEN_A)).toBe(1000n);
  });

  it('handles empty outputTokens', () => {
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 1000n]]);

    const result = subtractOutputTokens(accumulated, []);

    expect(result.get(TOKEN_A)).toBe(1000n);
  });

  it('handles subtracting tokens not in accumulated', () => {
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 1000n]]);
    const outputTokens = [{ address: TOKEN_B, amount: 500n }];

    const result = subtractOutputTokens(accumulated, outputTokens);

    expect(result.get(TOKEN_A)).toBe(1000n);
    expect(result.has(TOKEN_B)).toBe(false);
  });
});

describe('isEnoughOutputTokens', () => {
  it('returns true when all targets are met', () => {
    const target = new Map<Address, bigint>([
      [TOKEN_A, 1000n],
      [TOKEN_B, 500n],
    ]);
    const accumulated = new Map<Address, bigint>([
      [TOKEN_A, 1000n],
      [TOKEN_B, 500n],
    ]);

    expect(isEnoughOutputTokens(target, accumulated)).toBe(true);
  });

  it('returns true when accumulated exceeds target', () => {
    const target = new Map<Address, bigint>([[TOKEN_A, 1000n]]);
    const accumulated = new Map<Address, bigint>([[TOKEN_A, 2000n]]);

    expect(isEnoughOutputTokens(target, accumulated)).toBe(true);
  });

  it('returns false when any target is not met', () => {
    const target = new Map<Address, bigint>([
      [TOKEN_A, 1000n],
      [TOKEN_B, 500n],
    ]);
    const accumulated = new Map<Address, bigint>([
      [TOKEN_A, 1000n],
      [TOKEN_B, 400n],
    ]);

    expect(isEnoughOutputTokens(target, accumulated)).toBe(false);
  });

  it('returns false when accumulated is empty', () => {
    const target = new Map<Address, bigint>([[TOKEN_A, 1000n]]);
    const accumulated = new Map<Address, bigint>();

    expect(isEnoughOutputTokens(target, accumulated)).toBe(false);
  });

  it('returns true for empty target', () => {
    const target = new Map<Address, bigint>();
    const accumulated = new Map<Address, bigint>();

    expect(isEnoughOutputTokens(target, accumulated)).toBe(true);
  });
});

// ── Class method tests ──────────────────────────────────────────────────

describe('OrderService', () => {
  let service: OrderService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrderService();
  });

  describe('buildSameChainCumulativeGroups', () => {
    it('creates one group per run separated by cross-chain tokens', () => {
      const srcTokens: SrcToken[] = [
        { chainId: 8453n, address: TOKEN_A, amount: 100n },
        { chainId: 42161n, address: TOKEN_C, amount: 300n },
        { chainId: 8453n, address: TOKEN_B, amount: 200n },
      ];
      const resolvedTokens = new Map<string, TokenWithAmount>([
        [`8453:${TOKEN_A}`, { address: TOKEN_A, amount: 100n }],
        [`42161:${TOKEN_C}`, { address: TOKEN_C, amount: 300n }],
        [`8453:${TOKEN_B}`, { address: TOKEN_B, amount: 200n }],
      ]);

      const result = buildSameChainCumulativeGroups(
        srcTokens,
        8453n,
        resolvedTokens
      );

      // S1 in run 1, cross-chain gap, S2 in run 2
      expect(result).toHaveLength(2);
      expect(result[0]!.chainId).toBe(8453n);
      expect(result[0]!.tokens).toHaveLength(1);
      expect(result[0]!.tokens[0]!.address).toBe(TOKEN_A);
      expect(result[1]!.tokens).toHaveLength(2);
      expect(result[1]!.tokens[0]!.address).toBe(TOKEN_A);
      expect(result[1]!.tokens[1]!.address).toBe(TOKEN_B);
    });

    it('accumulates adjacent same-chain tokens into one group', () => {
      const srcTokens: SrcToken[] = [
        { chainId: 8453n, address: TOKEN_A, amount: 100n },
        { chainId: 8453n, address: TOKEN_B, amount: 200n },
        { chainId: 42161n, address: TOKEN_C, amount: 300n },
      ];
      const resolvedTokens = new Map<string, TokenWithAmount>([
        [`8453:${TOKEN_A}`, { address: TOKEN_A, amount: 100n }],
        [`8453:${TOKEN_B}`, { address: TOKEN_B, amount: 200n }],
        [`42161:${TOKEN_C}`, { address: TOKEN_C, amount: 300n }],
      ]);

      const result = buildSameChainCumulativeGroups(
        srcTokens,
        8453n,
        resolvedTokens
      );

      // S1 and S2 adjacent → single group [S1, S2]
      expect(result).toHaveLength(1);
      expect(result[0]!.tokens).toHaveLength(2);
      expect(result[0]!.tokens[0]!.address).toBe(TOKEN_A);
      expect(result[0]!.tokens[1]!.address).toBe(TOKEN_B);
    });

    it('accumulates across multiple runs', () => {
      const EXTRA = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02914' as Address;
      const srcTokens: SrcToken[] = [
        { chainId: 8453n, address: TOKEN_A, amount: 100n },
        { chainId: 8453n, address: TOKEN_B, amount: 200n },
        { chainId: 42161n, address: TOKEN_C, amount: 300n },
        { chainId: 42161n, address: EXTRA, amount: 400n },
        { chainId: 8453n, address: TOKEN_C, amount: 500n },
      ];
      const resolvedTokens = new Map<string, TokenWithAmount>([
        [`8453:${TOKEN_A}`, { address: TOKEN_A, amount: 100n }],
        [`8453:${TOKEN_B}`, { address: TOKEN_B, amount: 200n }],
        [`42161:${TOKEN_C}`, { address: TOKEN_C, amount: 300n }],
        [`42161:${EXTRA}`, { address: EXTRA, amount: 400n }],
        [`8453:${TOKEN_C}`, { address: TOKEN_C, amount: 500n }],
      ]);

      const result = buildSameChainCumulativeGroups(
        srcTokens,
        8453n,
        resolvedTokens
      );

      // Run 1: [S1, S2], then gap, Run 2: [S3]
      // Groups: [S1, S2], [S1, S2, S3]
      expect(result).toHaveLength(2);
      expect(result[0]!.tokens).toHaveLength(2);
      expect(result[1]!.tokens).toHaveLength(3);
      expect(result[1]!.tokens[2]!.address).toBe(TOKEN_C);
    });

    it('returns empty when no same-chain tokens', () => {
      const srcTokens: SrcToken[] = [
        { chainId: 42161n, address: TOKEN_A, amount: 100n },
      ];
      const resolvedTokens = new Map<string, TokenWithAmount>([
        [`42161:${TOKEN_A}`, { address: TOKEN_A, amount: 100n }],
      ]);

      const result = buildSameChainCumulativeGroups(
        srcTokens,
        8453n,
        resolvedTokens
      );

      expect(result).toHaveLength(0);
    });

    it('skips tokens not in resolvedTokens', () => {
      const srcTokens: SrcToken[] = [
        { chainId: 8453n, address: TOKEN_A, amount: 0n },
        { chainId: 8453n, address: TOKEN_B, amount: 200n },
      ];
      const resolvedTokens = new Map<string, TokenWithAmount>([
        [`8453:${TOKEN_B}`, { address: TOKEN_B, amount: 200n }],
      ]);

      const result = buildSameChainCumulativeGroups(
        srcTokens,
        8453n,
        resolvedTokens
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.tokens).toHaveLength(1);
      expect(result[0]!.tokens[0]!.address).toBe(TOKEN_B);
    });
  });

  describe('buildCrossChainGroups', () => {
    it('groups cross-chain tokens by chain sorted ascending', () => {
      const srcTokens: SrcToken[] = [
        { chainId: 42161n, address: TOKEN_A, amount: 100n },
        { chainId: 10n, address: TOKEN_B, amount: 200n },
        { chainId: 42161n, address: TOKEN_C, amount: 300n },
      ];
      const resolvedTokens = new Map<string, TokenWithAmount>([
        [`42161:${TOKEN_A}`, { address: TOKEN_A, amount: 100n }],
        [`10:${TOKEN_B}`, { address: TOKEN_B, amount: 200n }],
        [`42161:${TOKEN_C}`, { address: TOKEN_C, amount: 300n }],
      ]);

      const result = buildCrossChainGroups(srcTokens, 8453n, resolvedTokens);

      expect(result).toHaveLength(2);
      expect(result[0]!.chainId).toBe(10n);
      expect(result[0]!.tokens).toHaveLength(1);
      expect(result[1]!.chainId).toBe(42161n);
      expect(result[1]!.tokens).toHaveLength(2);
    });

    it('returns empty when all tokens are same-chain', () => {
      const srcTokens: SrcToken[] = [
        { chainId: 8453n, address: TOKEN_A, amount: 100n },
      ];
      const resolvedTokens = new Map<string, TokenWithAmount>([
        [`8453:${TOKEN_A}`, { address: TOKEN_A, amount: 100n }],
      ]);

      const result = buildCrossChainGroups(srcTokens, 8453n, resolvedTokens);

      expect(result).toHaveLength(0);
    });

    it('skips tokens not in resolvedTokens', () => {
      const srcTokens: SrcToken[] = [
        { chainId: 42161n, address: TOKEN_A, amount: 0n },
        { chainId: 42161n, address: TOKEN_B, amount: 200n },
      ];
      const resolvedTokens = new Map<string, TokenWithAmount>([
        [`42161:${TOKEN_B}`, { address: TOKEN_B, amount: 200n }],
      ]);

      const result = buildCrossChainGroups(srcTokens, 8453n, resolvedTokens);

      expect(result).toHaveLength(1);
      expect(result[0]!.tokens).toHaveLength(1);
      expect(result[0]!.tokens[0]!.address).toBe(TOKEN_B);
    });
  });

  describe('processQuote', () => {
    const baseParams = () => ({
      order: createMockOrder(),
      route: createMockRouteQuote(),
      routeIdx: 0,
      sortedRoutes: [createMockRouteQuote()],
      chainTokens: [
        { address: TOKEN_A, amount: 5000000n },
      ] as TokenWithAmount[],
      srcGasCost: 100000n,
      srcGasPrice: 1000000000n,
      unfilledOutputTokens: [
        { address: TOKEN_B, amount: 990000n },
      ] as TokenWithAmount[],
      targetCalls: [] as { data: Hex; mode: Hex }[],
      bridgeType: 'CCTP' as const,
    });

    beforeEach(() => {
      vi.mocked(chainService.getGasPrice).mockResolvedValue(1000000000n);
      vi.mocked(convertTokenAmount).mockImplementation(
        async (_c, _f, _t, amount) => {
          return amount > 0n ? 50000n : 0n;
        }
      );
      vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValue(
        createMockMultiInputQuote()
      );
    });

    it('returns null when token not found in chainTokens', async () => {
      const params = baseParams();
      params.chainTokens = [{ address: TOKEN_C, amount: 5000000n }];

      const result = await service.processQuote(params);

      expect(result).toBeNull();
    });

    it('returns null when balance insufficient for route without srcCalls', async () => {
      vi.mocked(convertTokenAmount).mockResolvedValue(4500000n);

      const params = baseParams();
      params.chainTokens = [{ address: TOKEN_A, amount: 1000000n }];

      const result = await service.processQuote(params);

      expect(result).toBeNull();
    });

    it('returns null when input tokens for quote is empty', async () => {
      vi.mocked(convertTokenAmount).mockResolvedValue(6000000n);

      const params = baseParams();

      const result = await service.processQuote(params);

      expect(result).toBeNull();
    });

    it('returns order and output tokens on success', async () => {
      const params = baseParams();
      const result = await service.processQuote(params);

      expect(result).not.toBeNull();
      expect(result!.order.srcIntent.token).toBe(TOKEN_A);
      expect(result!.outputTokens).toHaveLength(1);
      expect(result!.outputTokens[0]!.address).toBe(TOKEN_B);
      expect(result!.outputTokens[0]!.amount).toBe(990000n);
    });

    it('calls quoter with correct parameters', async () => {
      const params = baseParams();
      await service.processQuote(params);

      expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledWith(
        expect.objectContaining({
          depositor: SENDER,
          recipient: SENDER,
          originChainId: 42161,
          destinationChainId: 8453,
          bridgeType: 'CCTP',
        })
      );
    });

    it('includes payment token with gas amount', async () => {
      vi.mocked(convertTokenAmount).mockImplementation(
        async (_c, _f, _t, amount) => {
          return amount > 0n ? 75000n : 0n;
        }
      );

      const params = baseParams();
      const result = await service.processQuote(params);

      expect(result!.order.srcIntent.paymentTokens).toEqual([
        {
          recipient: FEE_RECIPIENT,
          token: TOKEN_A,
          amount: 75000n,
        },
      ]);
    });

    it('allows routes with srcCalls even when balance is low', async () => {
      vi.mocked(convertTokenAmount).mockResolvedValue(4500000n);

      const params = baseParams();
      params.route = createMockRouteQuote({
        srcCalls: [{ to: TOKEN_A, value: 0n, data: '0x' as Hex }],
      });
      params.chainTokens = [{ address: TOKEN_A, amount: 1000000n }];

      const result = await service.processQuote(params);

      expect(result).toBeNull();
    });
  });

  describe('getOrderHash', () => {
    it('returns deterministic hash for same order', () => {
      const order = createMockOrder();

      const hash1 = service.getOrderHash(order);
      const hash2 = service.getOrderHash(order);

      expect(hash1).toBe(hash2);
      expect(hash1.startsWith('0x')).toBe(true);
      expect(hash1).toHaveLength(66); // 0x + 64 hex chars
    });

    it('returns different hashes for different orders', () => {
      const order1 = createMockOrder({ openDeadline: 1000 });
      const order2 = createMockOrder({ openDeadline: 2000 });

      const hash1 = service.getOrderHash(order1);
      const hash2 = service.getOrderHash(order2);

      expect(hash1).not.toBe(hash2);
    });

    it('produces different hashes for different senders', () => {
      const order1 = createMockOrder({ sender: SENDER });
      const order2 = createMockOrder({
        sender: '0x9876543210987654321098765432109876543210' as Address,
      });

      expect(service.getOrderHash(order1)).not.toBe(
        service.getOrderHash(order2)
      );
    });
  });

  describe('submitSignedOrders', () => {
    it('validates and publishes orders successfully', async () => {
      vi.mocked(chainService.validateOrder).mockResolvedValue(undefined);
      vi.mocked(queuePublisher.publishOrder).mockResolvedValue(undefined);

      const order = createMockOrder();
      const result = await service.submitSignedOrders([order]);

      expect(chainService.validateOrder).toHaveBeenCalledWith(order, 42161n);
      expect(queuePublisher.publishOrder).toHaveBeenCalledWith({
        orders: [order],
      });
      expect(result.orderHashes).toHaveLength(1);
      expect(result.orderHashes[0]!.orderHash).toBeDefined();
    });

    it('throws when any order fails validation', async () => {
      vi.mocked(chainService.validateOrder).mockRejectedValue(
        new Error('Simulation failed')
      );

      const order = createMockOrder();

      await expect(service.submitSignedOrders([order])).rejects.toThrow(
        'Batch validation failed'
      );
      expect(queuePublisher.publishOrder).not.toHaveBeenCalled();
    });

    it('rejects entire batch if one order fails', async () => {
      const order1 = createMockOrder({ openDeadline: 1000 });
      const order2 = createMockOrder({ openDeadline: 2000 });

      vi.mocked(chainService.validateOrder)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Invalid'));

      await expect(
        service.submitSignedOrders([order1, order2])
      ).rejects.toThrow('Batch validation failed');
      expect(queuePublisher.publishOrder).not.toHaveBeenCalled();
    });

    it('handles multiple valid orders', async () => {
      vi.mocked(chainService.validateOrder).mockResolvedValue(undefined);
      vi.mocked(queuePublisher.publishOrder).mockResolvedValue(undefined);

      const orders = [
        createMockOrder({ openDeadline: 1000 }),
        createMockOrder({ openDeadline: 2000 }),
      ];

      const result = await service.submitSignedOrders(orders);

      expect(result.orderHashes).toHaveLength(2);
      expect(chainService.validateOrder).toHaveBeenCalledTimes(2);
    });

    it('handles non-Error throws in validation', async () => {
      vi.mocked(chainService.validateOrder).mockRejectedValue('raw string');

      const order = createMockOrder();

      await expect(service.submitSignedOrders([order])).rejects.toThrow(
        'Unknown error'
      );
    });
  });

  describe('getOrderOpenReceipt', () => {
    it('delegates to chainService', async () => {
      const mockReceipt = {
        event: {
          orderHash: '0xabc' as Hex,
          sender: SENDER,
          targetChainId: 8453n,
        },
        transaction: {
          hash: '0xtx' as Hex,
          blockNumber: 100n,
          blockHash: '0xblock' as Hex,
          from: SENDER,
          to: SENDER,
          status: 'success' as const,
          gasUsed: 21000n,
        },
      };
      vi.mocked(chainService.getOrderOpenReceipt).mockResolvedValue(
        mockReceipt
      );

      const result = await service.getOrderOpenReceipt('0xhash' as Hex, 42161n);

      expect(chainService.getOrderOpenReceipt).toHaveBeenCalledWith(
        '0xhash',
        42161n,
        undefined
      );
      expect(result).toBe(mockReceipt);
    });

    it('passes interopExecutor when provided', async () => {
      vi.mocked(chainService.getOrderOpenReceipt).mockResolvedValue(null);
      const executor = '0x0000000000000000000000000000000000000099' as Address;

      await service.getOrderOpenReceipt('0xhash' as Hex, 42161n, executor);

      expect(chainService.getOrderOpenReceipt).toHaveBeenCalledWith(
        '0xhash',
        42161n,
        executor
      );
    });
  });

  describe('getOrderFillReceipt', () => {
    it('delegates to chainService', async () => {
      const mockReceipt = {
        event: {
          orderHash: '0xabc' as Hex,
          sender: SENDER,
          srcChainId: 42161n,
        },
        transaction: {
          hash: '0xtx' as Hex,
          blockNumber: 100n,
          blockHash: '0xblock' as Hex,
          from: SENDER,
          to: SENDER,
          status: 'success' as const,
          gasUsed: 21000n,
        },
      };
      vi.mocked(chainService.getOrderFillReceipt).mockResolvedValue(
        mockReceipt
      );

      const result = await service.getOrderFillReceipt('0xhash' as Hex, 8453n);

      expect(chainService.getOrderFillReceipt).toHaveBeenCalledWith(
        '0xhash',
        8453n,
        undefined
      );
      expect(result).toBe(mockReceipt);
    });

    it('passes interopExecutor when provided', async () => {
      vi.mocked(chainService.getOrderFillReceipt).mockResolvedValue(null);
      const executor = '0x0000000000000000000000000000000000000099' as Address;

      await service.getOrderFillReceipt('0xhash' as Hex, 8453n, executor);

      expect(chainService.getOrderFillReceipt).toHaveBeenCalledWith(
        '0xhash',
        8453n,
        executor
      );
    });
  });

  describe('prepareOrder', () => {
    beforeEach(() => {
      // Reset all mocks to clear once-queues from prior tests
      vi.mocked(quoterClient.getQuoteMultiInput).mockReset();
      vi.mocked(quoterClient.getSwapRoute).mockReset();
      vi.mocked(orderBuilderService.createStubOrder).mockReset();
      vi.mocked(convertTokenAmount).mockReset();

      vi.mocked(chainService.getExecutionNonce).mockResolvedValue(1n);
      vi.mocked(chainService.getPaymentNonce).mockResolvedValue(1n);
      vi.mocked(chainService.getGasPrice).mockResolvedValue(1000000000n);
      vi.mocked(chainService.estimateSrcGas).mockResolvedValue({
        gasCost: 100000n,
        gasPrice: 1000000000n,
      });
      vi.mocked(convertTokenAmount).mockImplementation(
        async (_c, _f, _t, amount) => {
          return amount > 0n ? 50000n : 0n;
        }
      );
      vi.mocked(orderBuilderService.createStubOrder).mockReturnValue(
        createMockOrder()
      );
      vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
        id: 'route-1',
        routes: [createMockRouteQuote()],
      });
      vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValue(
        createMockMultiInputQuote()
      );
    });

    it('routes to gas-only flow when targetTokens is empty', async () => {
      const gasOnlyOrder = createMockOrder({
        srcIntent: {
          ...createMockOrder().srcIntent,
          chainId: 42161n,
          amount: 0n,
        },
        targetIntent: {
          ...createMockOrder().targetIntent,
          amount: 0n,
          validations: [],
        },
      });

      vi.mocked(
        orderBuilderService.createGasOnlySameChainOrder
      ).mockReturnValue(gasOnlyOrder);
      vi.mocked(orderBuilderService.createGasOnlyLZOrder).mockReturnValue(
        gasOnlyOrder
      );

      const result = await service.prepareOrder({
        sender: SENDER,
        initData: '0x' as Hex,
        targetChainId: 42161n,
        targetTokens: [],
        targetCalls: [],
        srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 1000000n }],
      });

      expect(result.orders).toHaveLength(1);
      expect(result.outputTokens).toEqual([]);
    });

    it('prepares a single order when target is met', async () => {
      const result = await service.prepareOrder({
        sender: SENDER,
        initData: '0x' as Hex,
        targetChainId: 8453n,
        targetTokens: [{ address: TOKEN_B, amount: 990000n }],
        targetCalls: [],
        srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
      });

      expect(result.orders).toHaveLength(1);
      expect(chainService.getExecutionNonce).toHaveBeenCalledWith(
        8453n,
        SENDER
      );
    });

    it('throws InsufficientOutputError when target not met', async () => {
      vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValue(
        createMockMultiInputQuote({
          outputTokens: [{ address: TOKEN_B, amount: 100n }],
        })
      );

      await expect(
        service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 99000000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        })
      ).rejects.toThrow('Insufficient output amount');
    });

    it('defaults bridgeType to CCTP', async () => {
      await service.prepareOrder({
        sender: SENDER,
        initData: '0x' as Hex,
        targetChainId: 8453n,
        targetTokens: [{ address: TOKEN_B, amount: 990000n }],
        targetCalls: [],
        srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
      });

      expect(quoterClient.getSwapRoute).toHaveBeenCalledWith(
        expect.objectContaining({ bridgeType: 'CCTP' })
      );
    });

    it('groups and processes multiple chains', async () => {
      vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValue(
        createMockMultiInputQuote({
          outputTokens: [{ address: TOKEN_B, amount: 500000n }],
        })
      );

      vi.mocked(chainService.getTokenInfo).mockResolvedValue({
        balance: 5000000n,
        decimals: 6,
      });

      const result = await service.prepareOrder({
        sender: SENDER,
        initData: '0x' as Hex,
        targetChainId: 8453n,
        targetTokens: [{ address: TOKEN_B, amount: 500000n }],
        targetCalls: [],
        srcTokens: [
          { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
          { chainId: 10n, address: TOKEN_C, amount: 5000000n },
        ],
      });

      expect(result.orders.length).toBeGreaterThanOrEqual(1);
    });

    // ── Balance Resolution ─────────────────────────────────────────────

    describe('balance resolution', () => {
      it('fetches balance when srcToken amount is 0 and uses it', async () => {
        vi.mocked(chainService.getTokenInfo).mockResolvedValue({
          balance: 3000000n,
          decimals: 6,
        });

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 0n }],
        });

        expect(chainService.getTokenInfo).toHaveBeenCalledWith(
          42161n,
          TOKEN_A,
          SENDER
        );
        expect(result.orders).toHaveLength(1);
      });

      it('throws InsufficientOutputError when all tokens resolve to zero balance', async () => {
        vi.mocked(chainService.getTokenInfo).mockResolvedValue({
          balance: 0n,
          decimals: 6,
        });

        await expect(
          service.prepareOrder({
            sender: SENDER,
            initData: '0x' as Hex,
            targetChainId: 8453n,
            targetTokens: [{ address: TOKEN_B, amount: 990000n }],
            targetCalls: [],
            srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 0n }],
          })
        ).rejects.toThrow('Insufficient output amount');
      });
    });

    // ── Single Chain, Single Route ─────────────────────────────────────

    describe('single chain, single route', () => {
      it('throws when route balance is insufficient for inputAmount plus gas', async () => {
        vi.mocked(convertTokenAmount).mockResolvedValue(4500000n);

        await expect(
          service.prepareOrder({
            sender: SENDER,
            initData: '0x' as Hex,
            targetChainId: 8453n,
            targetTokens: [{ address: TOKEN_B, amount: 990000n }],
            targetCalls: [],
            srcTokens: [
              { chainId: 42161n, address: TOKEN_A, amount: 1000000n },
            ],
          })
        ).rejects.toThrow('Insufficient output amount');
      });

      // it('processes route with srcCalls even when balance is low', async () => {
      //   vi.mocked(convertTokenAmount).mockResolvedValue(500000n);
      //   vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
      //     id: 'route-1',
      //     routes: [
      //       createMockRouteQuote({
      //         inputToken: TOKEN_A,
      //         srcCalls: [{ to: TOKEN_A, value: 0n, data: '0x' as Hex }],
      //       }),
      //     ],
      //   });

      //   const result = await service.prepareOrder({
      //     sender: SENDER,
      //     initData: '0x' as Hex,
      //     targetChainId: 8453n,
      //     targetTokens: [{ address: TOKEN_B, amount: 990000n }],
      //     targetCalls: [],
      //     srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 1000000n }],
      //   });

      //   expect(result.orders).toHaveLength(1);
      // });
      it('processes route with srcCalls even when balance is low', async () => {
        vi.mocked(convertTokenAmount).mockImplementation(
          async (_c, _f, _t, amount) => (amount > 0n ? 500000n : 0n)
        );
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({
              inputToken: TOKEN_A,
              srcCalls: [{ to: TOKEN_A, value: 0n, data: '0x' as Hex }],
            }),
          ],
        });

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 1000000n }],
        });

        expect(result.orders).toHaveLength(1);
      });

      it('throws when gas payment exceeds entire available balance', async () => {
        vi.mocked(convertTokenAmount).mockResolvedValue(6000000n);

        await expect(
          service.prepareOrder({
            sender: SENDER,
            initData: '0x' as Hex,
            targetChainId: 8453n,
            targetTokens: [{ address: TOKEN_B, amount: 990000n }],
            targetCalls: [],
            srcTokens: [
              { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            ],
          })
        ).rejects.toThrow('Insufficient output amount');
      });
    });

    // ── Single Chain, Multiple Routes ──────────────────────────────────

    describe('single chain, multiple routes', () => {
      it('returns early after first route when target is fully met', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({ inputToken: TOKEN_A }),
            createMockRouteQuote({ inputToken: TOKEN_C }),
          ],
        });

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(1);
        expect(result.orders).toHaveLength(1);
      });

      it('accumulates output from multiple routes until target is met', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({ inputToken: TOKEN_A }),
            createMockRouteQuote({ inputToken: TOKEN_C }),
          ],
        });

        vi.mocked(quoterClient.getQuoteMultiInput)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            })
          )
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 990000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(2);
        expect(result.orders).toHaveLength(1);
      });

      it('skips routes where input token not found in chainTokens', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({ inputToken: TOKEN_C }),
            createMockRouteQuote({ inputToken: TOKEN_A }),
          ],
        });

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(1);
        expect(result.orders).toHaveLength(1);
      });

      it('accumulates swap fees across routes into srcGas', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({
              inputToken: TOKEN_A,
              fees: {
                details: [
                  {
                    type: 'swap',
                    amount: 1000n,
                    token: {
                      address: TOKEN_A,
                      chainId: 42161,
                      name: 'USDC',
                      symbol: 'USDC',
                      decimals: 6,
                    },
                  },
                ],
              },
            }),
          ],
        });

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        // convertTokenAmount called twice: swap fee native→token, gas native→token
        expect(convertTokenAmount).toHaveBeenCalledTimes(2);
        expect(result.orders).toHaveLength(1);
      });
    });

    // ── Multiple Chains ────────────────────────────────────────────────

    describe('multiple chains', () => {
      it('returns early when first chain meets all target amounts', async () => {
        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 10n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        expect(result.orders).toHaveLength(1);
        expect(quoterClient.getSwapRoute).toHaveBeenCalledTimes(2);
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(1);
      });

      it('accumulates output from multiple chains until target is met', async () => {
        vi.mocked(quoterClient.getSwapRoute)
          .mockResolvedValueOnce({
            id: 'route-1',
            routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
          })
          .mockResolvedValueOnce({
            id: 'route-2',
            routes: [createMockRouteQuote({ inputToken: TOKEN_C })],
          });

        vi.mocked(quoterClient.getQuoteMultiInput)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            })
          )
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 10n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        expect(result.orders).toHaveLength(2);
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(2);
      });

      it('fetches routes for chains in ascending chainId order', async () => {
        const chainIds: number[] = [];
        vi.mocked(quoterClient.getSwapRoute).mockImplementation(
          async (params) => {
            chainIds.push(params.originChainId);
            return {
              id: `route-${params.originChainId}`,
              routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
            };
          }
        );

        await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 10n, address: TOKEN_A, amount: 5000000n },
          ],
        });

        expect(chainIds).toEqual([10, 42161]);
      });

      it('processes tokens in user-provided srcToken order', async () => {
        const quoteChainIds: number[] = [];
        // Mock swap routes in chain sort order (ascending): 10, 42161
        vi.mocked(quoterClient.getSwapRoute)
          .mockResolvedValueOnce({
            id: 'route-1',
            routes: [createMockRouteQuote({ inputToken: TOKEN_C })],
          })
          .mockResolvedValueOnce({
            id: 'route-2',
            routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
          });

        // Stub orders must have correct chainId for each chain (sorted: 10, 42161)
        vi.mocked(orderBuilderService.createStubOrder)
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 10n },
            })
          )
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 42161n },
            })
          );

        vi.mocked(quoterClient.getQuoteMultiInput).mockImplementation(
          async (params) => {
            quoteChainIds.push(params.originChainId);
            return createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            });
          }
        );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 10n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        // Tokens processed in user order: 42161 first, then 10
        expect(quoteChainIds).toEqual([42161, 10]);
        expect(result.orders).toHaveLength(2);
      });

      it('continues when one chain returns empty routes', async () => {
        vi.mocked(quoterClient.getSwapRoute)
          .mockResolvedValueOnce({
            id: 'route-1',
            routes: [],
          })
          .mockResolvedValueOnce({
            id: 'route-2',
            routes: [createMockRouteQuote({ inputToken: TOKEN_C })],
          });

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 10n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        expect(result.orders).toHaveLength(1);
      });
    });

    // ── Multiple Target Tokens ─────────────────────────────────────────

    describe('multiple target tokens', () => {
      it('meets multiple target tokens in a single route', async () => {
        vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValue(
          createMockMultiInputQuote({
            outputTokens: [
              { address: TOKEN_B, amount: 500000n },
              { address: TOKEN_C, amount: 300000n },
            ],
          })
        );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [
            { address: TOKEN_B, amount: 500000n },
            { address: TOKEN_C, amount: 300000n },
          ],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        expect(result.orders).toHaveLength(1);
      });

      it('passes only unfilled target tokens to subsequent chains', async () => {
        vi.mocked(quoterClient.getSwapRoute)
          .mockResolvedValueOnce({
            id: 'route-1',
            routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
          })
          .mockResolvedValueOnce({
            id: 'route-2',
            routes: [createMockRouteQuote({ inputToken: TOKEN_C })],
          });

        vi.mocked(quoterClient.getQuoteMultiInput)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [
                { address: TOKEN_B, amount: 990000n },
                { address: TOKEN_C, amount: 200000n },
              ],
            })
          )
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_C, amount: 100000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [
            { address: TOKEN_B, amount: 990000n },
            { address: TOKEN_C, amount: 300000n },
          ],
          targetCalls: [],
          srcTokens: [
            { chainId: 10n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        const secondCall = vi.mocked(quoterClient.getQuoteMultiInput).mock
          .calls[1]!;
        expect(secondCall[0].outputTokens).toEqual([
          { address: TOKEN_C, amount: 100000n },
        ]);
        expect(result.orders).toHaveLength(2);
      });

      it('accumulates multiple target tokens across chains', async () => {
        vi.mocked(quoterClient.getSwapRoute)
          .mockResolvedValueOnce({
            id: 'route-1',
            routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
          })
          .mockResolvedValueOnce({
            id: 'route-2',
            routes: [createMockRouteQuote({ inputToken: TOKEN_C })],
          });

        vi.mocked(quoterClient.getQuoteMultiInput)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 990000n }],
            })
          )
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_C, amount: 300000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [
            { address: TOKEN_B, amount: 990000n },
            { address: TOKEN_C, amount: 300000n },
          ],
          targetCalls: [],
          srcTokens: [
            { chainId: 10n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        expect(result.orders).toHaveLength(2);
      });
    });

    // ── Bridge Type ────────────────────────────────────────────────────

    describe('bridge type', () => {
      it('passes explicit ACROSS bridgeType to quoter route and quote', async () => {
        await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
          bridgeType: 'ACROSS',
        });

        expect(quoterClient.getSwapRoute).toHaveBeenCalledWith(
          expect.objectContaining({ bridgeType: 'ACROSS' })
        );
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledWith(
          expect.objectContaining({ bridgeType: 'ACROSS' })
        );
      });
    });

    // ── Gas & Fee Calculations ─────────────────────────────────────────

    describe('gas and fee calculations', () => {
      it('includes gas payment in srcIntent paymentTokens', async () => {
        vi.mocked(convertTokenAmount).mockImplementation(
          async (_c, _f, _t, amount) => {
            return amount > 0n ? 75000n : 0n;
          }
        );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        expect(result.orders[0]!.srcIntent.paymentTokens).toEqual([
          {
            recipient: FEE_RECIPIENT,
            token: TOKEN_A,
            amount: 75000n,
          },
        ]);
      });

      it('ignores swap fees from target chain, only accumulates source chain fees', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({
              inputToken: TOKEN_A,
              fees: {
                details: [
                  {
                    type: 'swap',
                    amount: 1000n,
                    token: {
                      address: TOKEN_B,
                      chainId: 8453,
                      name: 'USDC',
                      symbol: 'USDC',
                      decimals: 6,
                    },
                  },
                ],
              },
            }),
          ],
        });

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        // Fee has chainId 8453 but source chain is 42161 → fee filtered out
        // convertTokenAmount called 2 times:
        // 1. In collectInputTokensForQuote: converting 0 swap fee (to check if valid)
        // 2. In collectInputTokensForQuote: converting gas
        expect(convertTokenAmount).toHaveBeenCalledTimes(2);
        expect(result.orders).toHaveLength(1);
      });
    });

    // ── Input Token Collection ─────────────────────────────────────────

    describe('input token collection', () => {
      it('first route uses only current token minus gas as input', async () => {
        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledWith(
          expect.objectContaining({
            inputTokens: [{ address: TOKEN_A, amount: 4950000n }],
          })
        );
        expect(result.orders).toHaveLength(1);
      });

      it('subsequent routes include previous route tokens plus current token', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({ inputToken: TOKEN_A }),
            createMockRouteQuote({ inputToken: TOKEN_C }),
          ],
        });

        vi.mocked(quoterClient.getQuoteMultiInput)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 100000n }],
            })
          )
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 990000n }],
            })
          );

        await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 3000000n },
          ],
        });

        const secondCall = vi.mocked(quoterClient.getQuoteMultiInput).mock
          .calls[1]!;
        expect(secondCall[0].inputTokens).toEqual([
          { address: TOKEN_A, amount: 4950000n },
          { address: TOKEN_C, amount: 3000000n },
        ]);
      });
    });

    // ── Nonce Management ───────────────────────────────────────────────

    describe('nonce management', () => {
      it('fetches executionNonce once for target chain', async () => {
        await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        expect(chainService.getExecutionNonce).toHaveBeenCalledTimes(1);
        expect(chainService.getExecutionNonce).toHaveBeenCalledWith(
          8453n,
          SENDER
        );
      });

      it('fetches paymentNonce for each source chain', async () => {
        vi.mocked(quoterClient.getSwapRoute)
          .mockResolvedValueOnce({
            id: 'route-1',
            routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
          })
          .mockResolvedValueOnce({
            id: 'route-2',
            routes: [createMockRouteQuote({ inputToken: TOKEN_C })],
          });

        vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValue(
          createMockMultiInputQuote({
            outputTokens: [{ address: TOKEN_B, amount: 100n }],
          })
        );

        await expect(
          service.prepareOrder({
            sender: SENDER,
            initData: '0x' as Hex,
            targetChainId: 8453n,
            targetTokens: [{ address: TOKEN_B, amount: 990000n }],
            targetCalls: [],
            srcTokens: [
              { chainId: 10n, address: TOKEN_A, amount: 5000000n },
              { chainId: 42161n, address: TOKEN_C, amount: 5000000n },
            ],
          })
        ).rejects.toThrow();

        expect(chainService.getPaymentNonce).toHaveBeenCalledTimes(2);
        expect(chainService.getPaymentNonce).toHaveBeenCalledWith(10n, SENDER);
        expect(chainService.getPaymentNonce).toHaveBeenCalledWith(
          42161n,
          SENDER
        );
      });
    });

    // ── Target Calls & Data Passthrough ────────────────────────────────

    describe('target calls and data passthrough', () => {
      it('passes targetCalls through to final order executions', async () => {
        const targetCalls = [
          {
            data: '0xcall1' as Hex,
            mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
          },
          {
            data: '0xcall2' as Hex,
            mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
          },
        ];

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls,
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        // Default quote has 1 targetCall + our 2 = 3 executions
        expect(result.orders[0]!.targetIntent.executions).toHaveLength(3);
      });

      it('preserves sender and initData in stub order creation', async () => {
        await service.prepareOrder({
          sender: SENDER,
          initData: '0xdeadbeef' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        expect(orderBuilderService.createStubOrder).toHaveBeenCalledWith(
          expect.objectContaining({
            sender: SENDER,
            initData: '0xdeadbeef',
          })
        );
      });
    });

    // ── Immutability ───────────────────────────────────────────────────

    describe('immutability', () => {
      it('does not mutate input srcTokens array', async () => {
        const srcTokens = [
          { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
        ];
        const originalLength = srcTokens.length;
        const originalChainId = srcTokens[0]!.chainId;
        const originalAmount = srcTokens[0]!.amount;
        const originalAddress = srcTokens[0]!.address;

        await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens,
        });

        expect(srcTokens).toHaveLength(originalLength);
        expect(srcTokens[0]!.chainId).toBe(originalChainId);
        expect(srcTokens[0]!.amount).toBe(originalAmount);
        expect(srcTokens[0]!.address).toBe(originalAddress);
      });

      it('does not mutate input targetTokens array', async () => {
        const targetTokens = [{ address: TOKEN_B, amount: 990000n }];
        const originalLength = targetTokens.length;
        const originalAmount = targetTokens[0]!.amount;
        const originalAddress = targetTokens[0]!.address;

        await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens,
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 5000000n }],
        });

        expect(targetTokens).toHaveLength(originalLength);
        expect(targetTokens[0]!.amount).toBe(originalAmount);
        expect(targetTokens[0]!.address).toBe(originalAddress);
      });
    });

    // ── Error Scenarios ────────────────────────────────────────────────

    describe('error scenarios', () => {
      it('throws InsufficientOutputError with accumulated and target amounts', async () => {
        vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValue(
          createMockMultiInputQuote({
            outputTokens: [{ address: TOKEN_B, amount: 100n }],
          })
        );

        try {
          await service.prepareOrder({
            sender: SENDER,
            initData: '0x' as Hex,
            targetChainId: 8453n,
            targetTokens: [{ address: TOKEN_B, amount: 990000n }],
            targetCalls: [],
            srcTokens: [
              { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            ],
          });
          expect.unreachable('should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(InsufficientOutputError);
          const err = error as InsufficientOutputError;
          expect(err.accumulatedOutput.get(TOKEN_B)).toBe(100n);
          expect(err.targetAmounts.get(TOKEN_B)).toBe(990000n);
        }
      });

      it('throws InsufficientOutputError when all routes return null', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [createMockRouteQuote({ inputToken: TOKEN_C })],
        });

        await expect(
          service.prepareOrder({
            sender: SENDER,
            initData: '0x' as Hex,
            targetChainId: 8453n,
            targetTokens: [{ address: TOKEN_B, amount: 990000n }],
            targetCalls: [],
            srcTokens: [
              { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            ],
          })
        ).rejects.toThrow('Insufficient output amount');
      });

      it('creates gas-only LZ order when same-chain meets target but gas unpaid and cross-chain follows', async () => {
        // Same-chain token fully meets target but gas is NOT paid (all balance consumed by quote).
        // Cross-chain token comes next with zero unfilled output → creates gas-only LZ order.
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValueOnce({
          id: 'route-arb',
          routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
        });

        const gasOnlyOrder = createMockOrder({
          srcIntent: {
            ...createMockOrder().srcIntent,
            chainId: 42161n,
            adapter: LAYERZERO_ADAPTER,
            amount: 0n,
          },
          targetIntent: {
            ...createMockOrder().targetIntent,
            amount: 0n,
            validations: [],
          },
        });

        vi.mocked(orderBuilderService.createStubOrder)
          // Same-chain stub
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 8453n },
            })
          )
          // Cross-chain stub
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 42161n },
            })
          );

        vi.mocked(orderBuilderService.createGasOnlyLZOrder).mockReturnValueOnce(
          gasOnlyOrder
        );

        // Same-chain quote: consumes ALL input tokens, output meets target
        vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValueOnce(
          createMockMultiInputQuote({
            inputTokens: [{ address: TOKEN_C, amount: 5000000n }],
            outputTokens: [{ address: TOKEN_B, amount: 990000n }],
          })
        );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            // Same-chain first: output meets target, but gas not paid (all balance consumed)
            { chainId: 8453n, address: TOKEN_C, amount: 5000000n },
            // Cross-chain next: unfilled output is 0 → gas-only LZ order
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
          ],
        });

        expect(result.orders).toHaveLength(1);
        expect(result.orders[0]!.srcIntent.adapter).toBe(LAYERZERO_ADAPTER);
        expect(result.orders[0]!.srcIntent.amount).toBe(0n);
        expect(result.orders[0]!.targetIntent.amount).toBe(0n);
        expect(orderBuilderService.createGasOnlyLZOrder).toHaveBeenCalledWith(
          expect.objectContaining({
            sender: SENDER,
            srcChainId: 42161n,
            targetChainId: 8453n,
          })
        );
      });

      it('creates gas-only LZ order with correct srcChainId for each cross-chain source', async () => {
        // Same setup but cross-chain on chain 10 instead of 42161
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValueOnce({
          id: 'route-op',
          routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
        });

        const gasOnlyOrder = createMockOrder({
          srcIntent: {
            ...createMockOrder().srcIntent,
            chainId: 10n,
            adapter: LAYERZERO_ADAPTER,
            amount: 0n,
          },
          targetIntent: {
            ...createMockOrder().targetIntent,
            amount: 0n,
            validations: [],
          },
        });

        vi.mocked(orderBuilderService.createStubOrder)
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 8453n },
            })
          )
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 10n },
            })
          );

        vi.mocked(orderBuilderService.createGasOnlyLZOrder).mockReturnValueOnce(
          gasOnlyOrder
        );

        vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValueOnce(
          createMockMultiInputQuote({
            inputTokens: [{ address: TOKEN_C, amount: 5000000n }],
            outputTokens: [{ address: TOKEN_B, amount: 990000n }],
          })
        );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 8453n, address: TOKEN_C, amount: 5000000n },
            { chainId: 10n, address: TOKEN_A, amount: 5000000n },
          ],
        });

        expect(result.orders).toHaveLength(1);
        expect(orderBuilderService.createGasOnlyLZOrder).toHaveBeenCalledWith(
          expect.objectContaining({ srcChainId: 10n })
        );
      });
    });

    // ── Same-Chain Combination (Rule 1) ──────────────────────────────

    describe('same-chain combination (Rule 1)', () => {
      it('combines tokens on same chain and re-quotes with combined inputs', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({ inputToken: TOKEN_A }),
            createMockRouteQuote({ inputToken: TOKEN_C }),
          ],
        });

        vi.mocked(quoterClient.getQuoteMultiInput)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 400000n }],
            })
          )
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 990000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 3000000n },
          ],
        });

        // Two quotes: first for TOKEN_A alone, second for TOKEN_A+TOKEN_C combined
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(2);
        // Only one order since both tokens are on the same chain
        expect(result.orders).toHaveLength(1);
      });

      it('restores accumulated output when combined re-quote fails', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({ inputToken: TOKEN_A }),
            createMockRouteQuote({ inputToken: TOKEN_C }),
          ],
        });

        // First token alone meets target. Combined re-quote will fail (no input tokens).
        vi.mocked(quoterClient.getQuoteMultiInput).mockResolvedValueOnce(
          createMockMultiInputQuote({
            outputTokens: [{ address: TOKEN_B, amount: 990000n }],
          })
        );

        // Make combined re-quote fail: excessive gas on second processQuote call.
        // First processQuote makes 2 convertTokenAmount calls (swap fee + gas).
        let callCount = 0;
        vi.mocked(convertTokenAmount).mockImplementation(
          async (_c, _f, _t, amount) => {
            callCount++;
            // First token's processQuote (calls 1-2): normal gas
            if (callCount <= 2) return amount > 0n ? 50000n : 0n;
            // Combined re-quote (calls 3+): gas exceeds all balances → processQuote returns null
            return amount > 0n ? 99000000n : 0n;
          }
        );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 100n },
          ],
        });

        // First token alone met the target (combined re-quote failed, output restored)
        expect(result.orders).toHaveLength(1);
      });

      it('produces single order when two tokens on same chain combine to meet target', async () => {
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValue({
          id: 'route-1',
          routes: [
            createMockRouteQuote({ inputToken: TOKEN_A }),
            createMockRouteQuote({ inputToken: TOKEN_C }),
          ],
        });

        vi.mocked(quoterClient.getQuoteMultiInput)
          // First token alone: not enough
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 300000n }],
            })
          )
          // Combined (same chain Rule 1): meets target
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 990000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 3000000n },
          ],
        });

        expect(result.orders).toHaveLength(1);
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(2);
      });
    });

    // ── Same-Chain / Cross-Chain Interaction ──────────────────────────

    describe('same-chain and cross-chain interaction', () => {
      it('cross-chain tokens get reduced target from same-chain output', async () => {
        // Same-chain processed first, then cross-chain gets reduced unfilled
        // Fetch: getQuoteMultiInput for same-chain stub, getSwapRoute for cross-chain
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValueOnce({
          id: 'route-arb',
          routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
        });

        vi.mocked(orderBuilderService.createStubOrder)
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 8453n },
            })
          )
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 42161n },
            })
          );

        vi.mocked(quoterClient.getQuoteMultiInput)
          // Fetch phase: same-chain quote (used directly, no separate processQuote)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            })
          )
          // Cross-chain (42161n) processQuote: 500k (with reduced target of 490k)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 8453n, address: TOKEN_C, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
          ],
        });

        // Cross-chain quote requested with reduced unfilled amount (call index 1)
        const crossChainCall = vi.mocked(quoterClient.getQuoteMultiInput).mock
          .calls[1]!;
        expect(crossChainCall[0].outputTokens).toEqual([
          { address: TOKEN_B, amount: 490000n },
        ]);
        // 2 quotes: fetch stub (used directly for same-chain) + cross-chain processQuote
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(2);
        // Only cross-chain order is returned when there are cross-chain tokens
        expect(result.orders).toHaveLength(1);
      });

      it('handles cross-chain before same-chain in srcTokens order', async () => {
        // Cross-chain processed first with full target, then same-chain
        // Fetch: getQuoteMultiInput for same-chain stub, getSwapRoute for cross-chain
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValueOnce({
          id: 'route-arb',
          routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
        });

        vi.mocked(orderBuilderService.createStubOrder)
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 8453n },
            })
          )
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 42161n },
            })
          );

        vi.mocked(quoterClient.getQuoteMultiInput)
          // Fetch phase: same-chain stub order creation
          .mockResolvedValueOnce(createMockMultiInputQuote())
          // Cross-chain (42161n) processQuote: 500k (full target)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            })
          )
          // Same-chain (8453n) processQuote: 500k
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 8453n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        // 3 quotes: fetch stub + cross-chain processQuote + same-chain processQuote
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(3);
        // same-chain order excluded; swap executions prepended to cross-chain order
        expect(result.orders).toHaveLength(1);
      });
    });

    // ── 4-Step Example Scenario ──────────────────────────────────────

    describe('4-step example scenario', () => {
      it('USDC/Arb, USDC/Op, USDT/Arb, USDC/Base → USDT/Base', async () => {
        const USDC_ARB = TOKEN_A;
        const USDC_OP = TOKEN_B;
        const USDT_ARB = TOKEN_C;
        const USDC_BASE =
          '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02914' as Address;
        const USDT_BASE =
          '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff86' as Address;

        const ARB_CHAIN = 42161n;
        const OP_CHAIN = 10n;
        const BASE_CHAIN = 8453n; // target chain

        // Fetch: getQuoteMultiInput for same-chain stub, getSwapRoute for cross-chain (OP, ARB)
        vi.mocked(quoterClient.getSwapRoute)
          .mockResolvedValueOnce({
            id: 'route-op',
            routes: [createMockRouteQuote({ inputToken: USDC_OP })],
          })
          .mockResolvedValueOnce({
            id: 'route-arb',
            routes: [
              createMockRouteQuote({ inputToken: USDC_ARB }),
              createMockRouteQuote({ inputToken: USDT_ARB }),
            ],
          });

        // Stub orders: same-chain (BASE) first, then cross-chain (OP, ARB)
        vi.mocked(orderBuilderService.createStubOrder)
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: {
                ...createMockOrder().srcIntent,
                chainId: BASE_CHAIN,
              },
            })
          )
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: OP_CHAIN },
            })
          )
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: ARB_CHAIN },
            })
          );

        vi.mocked(quoterClient.getQuoteMultiInput)
          // Fetch phase: same-chain stub order creation
          .mockResolvedValueOnce(createMockMultiInputQuote())
          // Step 1: USDC/Arb alone (cross-chain)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: USDT_BASE, amount: 250000n }],
            })
          )
          // Step 2: USDC/Op alone (cross-chain, new chain)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: USDT_BASE, amount: 250000n }],
            })
          )
          // Step 3: USDT/Arb combined with USDC/Arb (cross-chain re-quote)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: USDT_BASE, amount: 400000n }],
            })
          )
          // Step 4: USDC/Base (same-chain, unfilled = 990k - 650k = 340k)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: USDT_BASE, amount: 350000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: BASE_CHAIN,
          targetTokens: [{ address: USDT_BASE, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: ARB_CHAIN, address: USDC_ARB, amount: 5000000n },
            { chainId: OP_CHAIN, address: USDC_OP, amount: 5000000n },
            { chainId: ARB_CHAIN, address: USDT_ARB, amount: 5000000n },
            { chainId: BASE_CHAIN, address: USDC_BASE, amount: 5000000n },
          ],
        });

        // 5 quote calls: fetch stub + Arb, Op, Arb+USDT, Base (no Rule 2 re-quoting)
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(5);
        // 2 cross-chain orders (Arb, Op); same-chain swap executions prepended
        expect(result.orders).toHaveLength(2);
      });
    });

    // ── Early Exit Scenarios ─────────────────────────────────────────

    describe('early exit scenarios', () => {
      it('exits early after same-chain combination meets target', async () => {
        // Chains sorted ascending: 10, 42161
        vi.mocked(quoterClient.getSwapRoute)
          .mockResolvedValueOnce({
            id: 'route-op',
            routes: [createMockRouteQuote({ inputToken: TOKEN_B })],
          })
          .mockResolvedValueOnce({
            id: 'route-arb',
            routes: [
              createMockRouteQuote({ inputToken: TOKEN_A }),
              createMockRouteQuote({ inputToken: TOKEN_C }),
            ],
          });

        vi.mocked(quoterClient.getQuoteMultiInput)
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 400000n }],
            })
          )
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 990000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 3000000n },
            { chainId: 10n, address: TOKEN_B, amount: 5000000n },
          ],
        });

        // Only 2 quotes: first token alone, then combined on same chain
        // Third token (chain 10) never processed
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(2);
        expect(result.orders).toHaveLength(1);
      });

      it('exits early after cross-chain plus same-chain meets target', async () => {
        // Cross-chain processed first, then same-chain finishes the target
        // Fetch: getQuoteMultiInput for same-chain stub, getSwapRoute for cross-chain
        vi.mocked(quoterClient.getSwapRoute).mockResolvedValueOnce({
          id: 'route-arb',
          routes: [createMockRouteQuote({ inputToken: TOKEN_A })],
        });

        vi.mocked(orderBuilderService.createStubOrder)
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 8453n },
            })
          )
          .mockReturnValueOnce(
            createMockOrder({
              srcIntent: { ...createMockOrder().srcIntent, chainId: 42161n },
            })
          );

        vi.mocked(quoterClient.getQuoteMultiInput)
          // Fetch phase: same-chain stub order creation
          .mockResolvedValueOnce(createMockMultiInputQuote())
          // Cross-chain (42161) processQuote: 500k
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            })
          )
          // Same-chain (8453) processQuote: 500k
          .mockResolvedValueOnce(
            createMockMultiInputQuote({
              outputTokens: [{ address: TOKEN_B, amount: 500000n }],
            })
          );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [{ address: TOKEN_B, amount: 990000n }],
          targetCalls: [],
          srcTokens: [
            { chainId: 42161n, address: TOKEN_A, amount: 5000000n },
            { chainId: 8453n, address: TOKEN_C, amount: 5000000n },
          ],
        });

        // 3 quotes: fetch stub + cross-chain processQuote + same-chain processQuote
        expect(quoterClient.getQuoteMultiInput).toHaveBeenCalledTimes(3);
        // same-chain order excluded; swap executions prepended to cross-chain order
        expect(result.orders).toHaveLength(1);
      });
    });

    // ── Gas-Only Flow (targetTokens=[]) ─────────────────────────────────

    describe('gas-only flow', () => {
      const gasOnlySameChainOrder = () =>
        createMockOrder({
          srcIntent: {
            ...createMockOrder().srcIntent,
            chainId: 8453n,
            adapter: '0x0000000000000000000000000000000000000000' as Address,
            adapterData: '0x' as Hex,
            amount: 0n,
          },
          targetIntent: {
            ...createMockOrder().targetIntent,
            chainId: 8453n,
            amount: 0n,
            validations: [],
          },
        });

      const gasOnlyCrossChainOrder = () =>
        createMockOrder({
          srcIntent: {
            ...createMockOrder().srcIntent,
            chainId: 42161n,
            adapter: LAYERZERO_ADAPTER,
            amount: 0n,
          },
          targetIntent: {
            ...createMockOrder().targetIntent,
            chainId: 8453n,
            amount: 0n,
            validations: [],
          },
        });

      it('creates same-chain gas-only order when srcToken is on targetChainId', async () => {
        vi.mocked(
          orderBuilderService.createGasOnlySameChainOrder
        ).mockReturnValue(gasOnlySameChainOrder());

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [],
          targetCalls: [
            {
              data: '0xcall' as Hex,
              mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
            },
          ],
          srcTokens: [{ chainId: 8453n, address: TOKEN_A, amount: 1000000n }],
        });

        expect(result.orders).toHaveLength(1);
        expect(result.outputTokens).toEqual([]);
        expect(result.inputTokens).toHaveLength(1);
        expect(result.inputTokens[0]!.chainId).toBe(8453n);
        expect(
          orderBuilderService.createGasOnlySameChainOrder
        ).toHaveBeenCalledTimes(2); // stub + final
      });

      it('creates cross-chain gas-only order when srcToken is on different chain', async () => {
        vi.mocked(orderBuilderService.createGasOnlyLZOrder).mockReturnValue(
          gasOnlyCrossChainOrder()
        );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [],
          targetCalls: [],
          srcTokens: [{ chainId: 42161n, address: TOKEN_A, amount: 1000000n }],
        });

        expect(result.orders).toHaveLength(1);
        expect(result.outputTokens).toEqual([]);
        expect(result.inputTokens[0]!.chainId).toBe(42161n);
        expect(orderBuilderService.createGasOnlyLZOrder).toHaveBeenCalledTimes(
          2
        ); // stub + final
      });

      it('returns early with first successful order (same-chain first)', async () => {
        vi.mocked(
          orderBuilderService.createGasOnlySameChainOrder
        ).mockReturnValue(gasOnlySameChainOrder());
        vi.mocked(orderBuilderService.createGasOnlyLZOrder).mockReturnValue(
          gasOnlyCrossChainOrder()
        );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [],
          targetCalls: [],
          srcTokens: [
            { chainId: 8453n, address: TOKEN_A, amount: 1000000n },
            { chainId: 42161n, address: TOKEN_C, amount: 1000000n },
          ],
        });

        // Returns after first token pays gas — only 1 order
        expect(result.orders).toHaveLength(1);
        expect(result.outputTokens).toEqual([]);
        // Cross-chain builder never called because same-chain succeeded first
        expect(orderBuilderService.createGasOnlyLZOrder).not.toHaveBeenCalled();
      });

      it('accumulates tokens on same chain and retries when first token insufficient', async () => {
        vi.mocked(
          orderBuilderService.createGasOnlySameChainOrder
        ).mockReturnValue(gasOnlySameChainOrder());
        vi.mocked(chainService.estimateSrcGas).mockResolvedValue({
          gasCost: 500000n, // gas costs 500k native
          gasPrice: 1000000000n,
        });

        // 1:1 native-to-token ratio, so 500k gas = 500k tokens needed.
        // First token has 100k (insufficient alone), combined 100k+500k = 600k (enough).
        vi.mocked(convertTokenAmount).mockImplementation(
          async (_chainId, _from, _to, amount) => amount
        );

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [],
          targetCalls: [],
          srcTokens: [
            { chainId: 8453n, address: TOKEN_A, amount: 100000n }, // too little alone
            { chainId: 8453n, address: TOKEN_B, amount: 500000n }, // combined: enough
          ],
        });

        expect(result.orders).toHaveLength(1);
        // Builder called 3 times: stub(attempt1 fail), stub+final(attempt2 success with accumulated)
        expect(
          orderBuilderService.createGasOnlySameChainOrder
        ).toHaveBeenCalledTimes(3);
      });

      it('falls through to cross-chain when same-chain tokens insufficient', async () => {
        // Same-chain token can't pay gas, cross-chain token can
        vi.mocked(
          orderBuilderService.createGasOnlySameChainOrder
        ).mockReturnValue(gasOnlySameChainOrder());
        vi.mocked(orderBuilderService.createGasOnlyLZOrder).mockReturnValue(
          gasOnlyCrossChainOrder()
        );

        // Make gas very expensive so same-chain (small balance) can't pay
        vi.mocked(convertTokenAmount).mockImplementation(
          async (_chainId, from, _to, amount) => {
            if (from === '0x0000000000000000000000000000000000000000') {
              return 99000000n; // gas is very expensive in token terms
            }
            return amount > 0n ? 1n : 0n; // tiny reverse conversion
          }
        );

        // Override estimateSrcGas for the cross-chain stub to succeed
        vi.mocked(chainService.estimateSrcGas)
          .mockResolvedValueOnce({ gasCost: 100000n, gasPrice: 1000000000n }) // same-chain stub
          .mockResolvedValueOnce({ gasCost: 1n, gasPrice: 1n }); // cross-chain stub: tiny gas

        // Second call: cross-chain succeeds with tiny gas
        vi.mocked(convertTokenAmount)
          .mockImplementationOnce(async () => 99000000n) // same-chain: native→token (too expensive)
          .mockImplementationOnce(async () => 1n) // same-chain: token→native
          .mockImplementationOnce(async () => 50000n); // cross-chain: native→token (affordable)

        const result = await service.prepareOrder({
          sender: SENDER,
          initData: '0x' as Hex,
          targetChainId: 8453n,
          targetTokens: [],
          targetCalls: [],
          srcTokens: [
            { chainId: 8453n, address: TOKEN_A, amount: 100n }, // too small
            { chainId: 42161n, address: TOKEN_C, amount: 1000000n }, // enough
          ],
        });

        expect(result.orders).toHaveLength(1);
        expect(result.inputTokens[0]!.chainId).toBe(42161n);
      });

      it('throws GasOnlyInsufficientFundsError with tried chains when no token can pay gas', async () => {
        // NATIVE_TOKEN is zeroAddress; native → token returns huge value,
        // token → native returns tiny value so gas is never fully covered
        vi.mocked(convertTokenAmount).mockImplementation(
          async (_chainId, from, _to, amount) => {
            if (from === '0x0000000000000000000000000000000000000000') {
              return 99000000n;
            }
            return amount > 0n ? 1n : 0n;
          }
        );

        vi.mocked(orderBuilderService.createGasOnlySameChainOrder).mockReset();
        vi.mocked(
          orderBuilderService.createGasOnlySameChainOrder
        ).mockReturnValue(gasOnlySameChainOrder());

        try {
          await service.prepareOrder({
            sender: SENDER,
            initData: '0x' as Hex,
            targetChainId: 8453n,
            targetTokens: [],
            targetCalls: [],
            srcTokens: [{ chainId: 8453n, address: TOKEN_A, amount: 100n }],
          });
          expect.unreachable('should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(GasOnlyInsufficientFundsError);
          const err = error as GasOnlyInsufficientFundsError;
          expect(err.targetChainId).toBe(8453n);
          expect(err.triedChains).toHaveLength(1);
          expect(err.triedChains[0]!.chainId).toBe(8453n);
          expect(err.triedChains[0]!.tokens[0]!.address).toBe(TOKEN_A);
          expect(err.triedChains[0]!.tokens[0]!.amount).toBe(100n);
          expect(err.message).toContain(
            'Insufficient funds for gas-only order'
          );
          expect(err.message).toContain('8453');
        }
      });
    });
  });
});
