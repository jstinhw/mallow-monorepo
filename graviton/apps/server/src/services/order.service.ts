import { queuePublisher } from '../queue/publisher.js';
import {
  type Order,
  serializeBigInt,
  type PaymentToken,
  NATIVE_TOKEN,
  convertTokenAmount,
  type TokenWithAmount,
  type RouteQuote,
  type BridgeType,
  type ExecutionCall,
} from '@graviton/core';
import {
  type Hex,
  type Address,
  keccak256,
  encodeAbiParameters,
  formatUnits,
  isAddressEqual,
} from 'viem';
import { chainService } from './chain.service.js';
import { orderBuilderService } from './order-builder.service.js';
import { quoterClient } from './clients/quoter.client.js';
import type {
  PrepareOrderRequest,
  PrepareOrderResponse,
} from '../api/schemas/prepare-order.schema.js';
import type { SubmitOrderResponse } from '../api/schemas/submit-order.schema.js';
import {
  FEE_RECIPIENT_ADDRESS,
  BALANCE_VALIDATOR_ADDRESS,
  LAYERZERO_ADAPTER,
  LZ_DEFAULT_NATIVE_FEE,
} from '../constants/contracts.js';
import {
  GasOnlyInsufficientFundsError,
  InsufficientGasError,
  InsufficientOutputError,
} from '../errors/index.js';
import {
  SrcToken,
  TargetToken,
  TargetCall,
  ChainTokenGroup,
  ChainRouteQuote,
  ChainOrderState,
  SameChainQuoteResult,
} from '../types/index.js';
import {
  encodeExecutionCall,
  encodeBalanceValidatorData,
} from '../utils/order.utils.js';

// ── Pure functions ──────────────────────────────────────────────────────

/**
 * Deduplicate tokens by address, keeping the higher amount when duplicates exist.
 */
export function deduplicateTokensByHigherAmount(
  tokens: { address: Address; amount: bigint }[]
): { address: Address; amount: bigint }[] {
  return tokens.reduce<{ address: Address; amount: bigint }[]>((acc, token) => {
    const idx = acc.findIndex((r) => isAddressEqual(r.address, token.address));
    if (idx === -1) {
      return [...acc, { address: token.address, amount: token.amount }];
    }
    if (token.amount > acc[idx]!.amount) {
      return acc.map((r, i) =>
        i === idx ? { address: token.address, amount: token.amount } : r
      );
    }
    return acc;
  }, []);
}

/**
 * Collect input tokens for multi-input quote (routes with srcCalls)
 */
export async function collectInputTokensForQuote(
  sortedRoutes: RouteQuote[],
  routeIdx: number,
  chainTokens: TokenWithAmount[],
  srcGasCost: bigint,
  gasPrice: bigint,
  srcChainId: bigint
): Promise<{ inputTokens: TokenWithAmount[]; paymentTokens: PaymentToken[] }> {
  const inputTokens: TokenWithAmount[] = [];
  const paymentTokens: PaymentToken[] = [];
  let remainingGasInNative = srcGasCost;

  for (let i = 0; i <= routeIdx; i++) {
    const route = sortedRoutes[i]!;
    const tokenInfo = chainTokens.find((t) =>
      isAddressEqual(t.address, route.inputToken)
    );

    if (!tokenInfo || tokenInfo.amount <= 0n) continue;

    const srcChainSwapFees = route.fees.details.filter(
      (f) => f.type === 'swap' && BigInt(f.token.chainId) === srcChainId
    );

    let routeSwapFeeInNative = 0n;
    for (const fee of srcChainSwapFees) {
      routeSwapFeeInNative += BigInt(fee.amount);
    }

    const routeSwapFeeInToken = await convertTokenAmount(
      Number(srcChainId),
      NATIVE_TOKEN,
      tokenInfo.address,
      routeSwapFeeInNative * gasPrice
    );

    let available = tokenInfo.amount;

    if (available < routeSwapFeeInToken) {
      continue;
    }

    let currentPaymentInToken = routeSwapFeeInToken;
    available -= routeSwapFeeInToken;
    // remainingGasInNative -= routeSwapFeeInNative;

    if (remainingGasInNative > 0n) {
      const remainingGasInToken = await convertTokenAmount(
        Number(srcChainId),
        NATIVE_TOKEN,
        tokenInfo.address,
        remainingGasInNative
      );

      if (available < remainingGasInToken) {
        currentPaymentInToken += available;
        const partialGasPaidInNative = await convertTokenAmount(
          Number(srcChainId),
          tokenInfo.address,
          NATIVE_TOKEN,
          available
        );
        remainingGasInNative -= partialGasPaidInNative;
        available = 0n;
      } else {
        currentPaymentInToken += remainingGasInToken;
        remainingGasInNative = 0n;
        available -= remainingGasInToken;

        if (available > 0n) {
          inputTokens.push({
            address: tokenInfo.address,
            amount: available,
          });
        }
      }
    } else if (available > 0n) {
      inputTokens.push({
        address: tokenInfo.address,
        amount: available,
      });
    }

    if (currentPaymentInToken > 0n) {
      paymentTokens.push({
        recipient: FEE_RECIPIENT_ADDRESS,
        token: tokenInfo.address,
        amount: currentPaymentInToken,
      });
    }
  }

  return { inputTokens, paymentTokens };
}

/**
 * Check if all target token amounts have been met
 */
export function isEnoughOutputTokens(
  targetAmountByToken: Map<Address, bigint>,
  accumulatedOutputByToken: Map<Address, bigint>
): boolean {
  return Array.from(targetAmountByToken.entries()).every(
    ([address, required]) =>
      (accumulatedOutputByToken.get(address) ?? 0n) >= required
  );
}

/**
 * Compute unfilled output tokens: target amounts minus what has been accumulated so far
 */
export function computeUnfilledOutputTokens(
  targetAmountByToken: Map<Address, bigint>,
  accumulatedOutputByToken: Map<Address, bigint>
): TokenWithAmount[] {
  return Array.from(targetAmountByToken.entries())
    .filter(
      ([address, required]) =>
        required > (accumulatedOutputByToken.get(address) ?? 0n)
    )
    .map(([address, required]) => ({
      address,
      amount: required - (accumulatedOutputByToken.get(address) ?? 0n),
    }));
}

/**
 * Merge new output tokens into an accumulated map, returning a new map
 */
export function mergeOutputTokens(
  accumulated: Map<Address, bigint>,
  outputTokens: TokenWithAmount[]
): Map<Address, bigint> {
  return new Map([
    ...accumulated,
    ...outputTokens.map(
      (o) => [o.address, (accumulated.get(o.address) ?? 0n) + o.amount] as const
    ),
  ]);
}

/**
 * Subtract output tokens from an accumulated map, returning a new map.
 * Inverse of mergeOutputTokens — removes a chain's previous output before re-quoting.
 */
export function subtractOutputTokens(
  accumulated: Map<Address, bigint>,
  outputTokens: TokenWithAmount[]
): Map<Address, bigint> {
  const result = new Map(accumulated);
  for (const o of outputTokens) {
    const current = result.get(o.address) ?? 0n;
    const updated = current - o.amount;
    if (updated <= 0n) {
      result.delete(o.address);
    } else {
      result.set(o.address, updated);
    }
  }
  return result;
}

/**
 * Collect all quoted input/output tokens from same-chain and cross-chain states,
 * tagged with their respective chainId.
 */
export function collectQuotedTokens(params: {
  targetChainId: bigint;
  sameChainInputTokens: TokenWithAmount[];
  sameChainOutputTokens: TokenWithAmount[];
  crossChainStates: Map<bigint, ChainOrderState>;
}): {
  inputTokens: { chainId: bigint; address: Address; amount: bigint }[];
  outputTokens: { chainId: bigint; address: Address; amount: bigint }[];
} {
  const {
    targetChainId,
    sameChainInputTokens,
    sameChainOutputTokens,
    crossChainStates,
  } = params;

  const inputTokens = [
    ...sameChainInputTokens.map((t) => ({
      chainId: targetChainId,
      address: t.address,
      amount: t.amount,
    })),
    ...Array.from(crossChainStates.values()).flatMap((s) =>
      s.inputTokens.map((t) => ({
        chainId: s.chainId,
        address: t.address,
        amount: t.amount,
      }))
    ),
  ];

  const rawOutputTokens = [
    ...sameChainOutputTokens,
    ...Array.from(crossChainStates.values()).flatMap((s) => s.outputTokens),
  ];

  const mergedOutputByAddress = new Map<Address, bigint>();
  for (const t of rawOutputTokens) {
    mergedOutputByAddress.set(
      t.address,
      (mergedOutputByAddress.get(t.address) ?? 0n) + t.amount
    );
  }

  const outputTokens = Array.from(mergedOutputByAddress.entries()).map(
    ([address, amount]) => ({ chainId: targetChainId, address, amount })
  );

  return { inputTokens, outputTokens };
}

/**
 * Build cumulative groups for same-chain tokens (chainId === targetChainId).
 * Adjacent same-chain tokens are accumulated into the same group.
 * A new group is created when a cross-chain token separates same-chain runs.
 *
 * Example: srcTokens = [S1, S2, A, B, S3] → [[S1,S2], [S1,S2,S3]]
 */
export function buildSameChainCumulativeGroups(
  srcTokens: SrcToken[],
  targetChainId: bigint,
  resolvedTokens: Map<string, TokenWithAmount>
): ChainTokenGroup[] {
  const groups: ChainTokenGroup[] = [];
  let accumulatedTokens: TokenWithAmount[] = [];
  let currentRunTokens: TokenWithAmount[] = [];

  for (const srcToken of srcTokens) {
    if (srcToken.chainId !== targetChainId) {
      if (currentRunTokens.length > 0) {
        accumulatedTokens = [...accumulatedTokens, ...currentRunTokens];
        groups.push({
          chainId: targetChainId,
          tokens: [...accumulatedTokens],
        });
        currentRunTokens = [];
      }
      continue;
    }

    const resolved = resolvedTokens.get(
      `${srcToken.chainId}:${srcToken.address}`
    );
    if (!resolved) continue;
    currentRunTokens.push(resolved);
  }

  if (currentRunTokens.length > 0) {
    accumulatedTokens = [...accumulatedTokens, ...currentRunTokens];
    groups.push({
      chainId: targetChainId,
      tokens: [...accumulatedTokens],
    });
  }

  return groups;
}

/**
 * Build one group per source chain for cross-chain tokens (chainId !== targetChainId).
 * Groups all tokens on the same source chain together, sorted ascending by chainId.
 */
export function buildCrossChainGroups(
  srcTokens: SrcToken[],
  targetChainId: bigint,
  resolvedTokens: Map<string, TokenWithAmount>
): ChainTokenGroup[] {
  const tokensByChain = new Map<bigint, TokenWithAmount[]>();

  for (const srcToken of srcTokens) {
    if (srcToken.chainId === targetChainId) continue;
    const resolved = resolvedTokens.get(
      `${srcToken.chainId}:${srcToken.address}`
    );
    if (!resolved) continue;
    const existing = tokensByChain.get(srcToken.chainId) ?? [];
    tokensByChain.set(srcToken.chainId, [...existing, resolved]);
  }

  return Array.from(tokensByChain.entries())
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([chainId, tokens]) => ({ chainId, tokens }));
}

/**
 * Calculate payment tokens to cover gas costs from available chain tokens.
 * Iterates through tokens, converting gas cost from native to each token's denomination.
 */
export async function calculatePaymentTokensFromGas(
  chainTokens: TokenWithAmount[],
  gasCost: bigint,
  chainId: bigint
): Promise<{
  paymentTokens: PaymentToken[];
  isGasPaid: boolean;
  remainingGasInNative: bigint;
}> {
  const paymentTokens: PaymentToken[] = [];
  let remainingGasInNative = gasCost;

  for (const token of chainTokens) {
    if (remainingGasInNative <= 0n) break;
    if (token.amount <= 0n) continue;

    const gasInToken = await convertTokenAmount(
      Number(chainId),
      NATIVE_TOKEN,
      token.address,
      remainingGasInNative
    );

    if (gasInToken <= 0n) continue;

    if (token.amount < gasInToken) {
      paymentTokens.push({
        recipient: FEE_RECIPIENT_ADDRESS,
        token: token.address,
        amount: token.amount,
      });
      const paidInNative = await convertTokenAmount(
        Number(chainId),
        token.address,
        NATIVE_TOKEN,
        token.amount
      );
      remainingGasInNative -= paidInNative;
    } else {
      paymentTokens.push({
        recipient: FEE_RECIPIENT_ADDRESS,
        token: token.address,
        amount: gasInToken,
      });
      remainingGasInNative = 0n;
    }
  }

  return {
    paymentTokens,
    isGasPaid: remainingGasInNative <= 0n,
    remainingGasInNative,
  };
}

/**
 * Prepend swap execution calls to an order's executions, skipping duplicates.
 * Returns a new order (immutable).
 */
export function prependUniqueExecutions(
  order: Order,
  swapExecutions: ExecutionCall[]
): Order {
  if (swapExecutions.length === 0) return order;

  const existingKeys = new Set(
    order.targetIntent.executions.map((e) => `${e.data}:${e.mode}`)
  );
  const unique = swapExecutions.filter(
    (e) => !existingKeys.has(`${e.data}:${e.mode}`)
  );

  if (unique.length === 0) return order;

  return {
    ...order,
    targetIntent: {
      ...order.targetIntent,
      executions: [...unique, ...order.targetIntent.executions],
    },
  };
}

/**
 * Update each order's balance validation amount to the total targetIntent.amount
 * across all orders. This ensures validators check the combined bridged balance.
 */
export function updateValidationsWithTotalAmount(orders: Order[]): Order[] {
  const totalAmount = orders.reduce(
    (sum, order) => sum + BigInt(order.targetIntent.amount),
    0n
  );

  return orders.map((order) => ({
    ...order,
    targetIntent: {
      ...order.targetIntent,
      validations: order.targetIntent.validations.map((v) =>
        isAddressEqual(v.validator, BALANCE_VALIDATOR_ADDRESS)
          ? {
              ...v,
              data: encodeBalanceValidatorData(totalAmount),
            }
          : v
      ),
    },
  }));
}

/**
 * Unify targetIntent.executions across all orders so they are identical.
 * Each cross-chain order may compute its own destination swaps independently,
 * but all orders targeting the same chain should share the same executions.
 * targetCalls are always placed last in the unified executions.
 */
export function unifyTargetExecutions(
  orders: Order[],
  targetCalls: ExecutionCall[]
): Order[] {
  if (orders.length <= 1) return orders;

  const targetCallKeys = new Set(
    targetCalls.map((tc) => `${tc.data}:${tc.mode}`)
  );

  const seenKeys = new Set<string>();
  const swapExecutions: ExecutionCall[] = [];

  for (const order of orders) {
    for (const execution of order.targetIntent.executions) {
      const key = `${execution.data}:${execution.mode}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      if (!targetCallKeys.has(key)) {
        swapExecutions.push(execution);
      }
    }
  }

  const unifiedExecutions = [...swapExecutions, ...targetCalls];

  return orders.map((order) => ({
    ...order,
    targetIntent: {
      ...order.targetIntent,
      executions: unifiedExecutions,
    },
  }));
}

// ── Service class ───────────────────────────────────────────────────────

export class OrderService {
  constructor() {}

  /**
   * Resolve balances for all source tokens in parallel.
   * Uses provided amount when > 0, otherwise fetches via chainService.getTokenInfo.
   * Returns Map keyed by `${chainId}:${address}`, excluding zero-balance tokens.
   */
  private async resolveTokenBalances(
    srcTokens: SrcToken[],
    sender: Address
  ): Promise<Map<string, TokenWithAmount>> {
    const entries = await Promise.all(
      srcTokens.map(async (srcToken) => {
        const key = `${srcToken.chainId}:${srcToken.address}`;
        if (srcToken.amount > 0n) {
          return {
            key,
            token: { address: srcToken.address, amount: srcToken.amount },
          };
        }
        const tokenInfo = await chainService.getTokenInfo(
          srcToken.chainId,
          srcToken.address,
          sender
        );
        if (tokenInfo.balance <= 0n) return null;
        return {
          key,
          token: { address: srcToken.address, amount: tokenInfo.balance },
        };
      })
    );

    return new Map(
      entries
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .map((e) => [e.key, e.token])
    );
  }

  /**
   * Process a single route: validate viability, fetch a multi-input quote, and build an order.
   *
   * Workflow:
   * 1. Find the route's input token in the chain's available tokens
   * 2. Convert gas cost from native units to the input token's denomination
   * 3. For direct routes (no srcCalls), verify balance covers input amount + gas
   * 4. Collect all available input tokens for the multi-input quote
   * 5. Fetch a multi-input quote from the quoter
   * 6. Build the final order with payment tokens and quote data
   *
   * Returns null if the route is not viable (token not found, insufficient balance, or no input tokens).
   *
   * TODO: should support any payment tokens
   * TODO: calculate input/output amount from route if no srcCalls
   */
  async processQuote(params: {
    order: Order;
    route: RouteQuote;
    routeIdx: number;
    sortedRoutes: RouteQuote[];
    chainTokens: TokenWithAmount[];
    srcGasCost: bigint;
    srcGasPrice: bigint;
    unfilledOutputTokens: TokenWithAmount[];
    targetCalls: TargetCall[];
    bridgeType: BridgeType;
  }): Promise<{
    order: Order;
    inputTokens: TokenWithAmount[];
    outputTokens: TokenWithAmount[];
  } | null> {
    const {
      order,
      route,
      routeIdx,
      sortedRoutes,
      chainTokens,
      srcGasCost,
      srcGasPrice,
      unfilledOutputTokens,
      targetCalls,
      bridgeType,
    } = params;

    // Step 1: Find the route's input token in available chain tokens
    const tokenInfo = chainTokens.find((t) =>
      isAddressEqual(t.address, route.inputToken)
    );
    if (!tokenInfo) return null;

    const srcChainId = order.srcIntent.chainId;

    // Step 4: Collect input tokens from this and prior routes for the multi-input quote
    const { inputTokens, paymentTokens } = await collectInputTokensForQuote(
      sortedRoutes,
      routeIdx,
      chainTokens,
      srcGasCost,
      srcGasPrice,
      srcChainId
    );
    if (inputTokens.length === 0) return null;

    // Step 5: Fetch a multi-input quote from the quoter
    const quote = await quoterClient.getQuoteMultiInput({
      depositor: order.sender,
      recipient: order.sender,
      originChainId: Number(srcChainId),
      destinationChainId: Number(order.targetIntent.chainId),
      inputTokens,
      outputTokens: unfilledOutputTokens,
      bridgeType,
    });

    // Step 6: Build the order with gas payment and quote data
    const updatedOrder = orderBuilderService.buildOrderFromQuote(
      order,
      quote,
      paymentTokens,
      targetCalls
    );

    const allInputByAddress = new Map<Address, bigint>();
    for (const t of quote.inputTokens) {
      allInputByAddress.set(
        t.address,
        (allInputByAddress.get(t.address) ?? 0n) + BigInt(t.amount)
      );
    }
    for (const p of paymentTokens) {
      allInputByAddress.set(
        p.token,
        (allInputByAddress.get(p.token) ?? 0n) + p.amount
      );
    }
    const allInputTokens = Array.from(allInputByAddress.entries()).map(
      ([address, amount]) => ({ address, amount })
    );

    const outputTokens = quote.outputTokens.map((t) => ({
      address: t.address,
      amount: BigInt(t.amount),
    }));

    return { order: updatedOrder, inputTokens: allInputTokens, outputTokens };
  }

  /**
   * Fetch a single quote for all same-chain tokens using getQuoteMultiInput.
   * Returns the stub order, gas estimates, and the raw quote response.
   */
  private async fetchSameChainQuote(params: {
    sameChainTokens: TokenWithAmount[];
    targetTokens: TargetToken[];
    targetChainId: bigint;
    bridgeType: BridgeType;
    sender: Address;
    initData: Hex;
    executionNonce: bigint;
    targetCalls: TargetCall[];
  }): Promise<SameChainQuoteResult | null> {
    const {
      sameChainTokens,
      targetTokens,
      targetChainId,
      bridgeType,
      sender,
      initData,
      executionNonce,
      targetCalls,
    } = params;

    if (sameChainTokens.length === 0) return null;

    const [quote, paymentNonce] = await Promise.all([
      quoterClient.getQuoteMultiInput({
        depositor: sender,
        recipient: sender,
        originChainId: Number(targetChainId),
        destinationChainId: Number(targetChainId),
        inputTokens: sameChainTokens,
        outputTokens: targetTokens,
        bridgeType,
      }),
      chainService.getPaymentNonce(targetChainId, sender),
    ]);

    const firstInputToken = quote.inputTokens[0]!;
    const syntheticRoute: RouteQuote = {
      inputToken: firstInputToken.address,
      inputAmount: firstInputToken.amount,
      srcCalls: [],
      swapCalls: quote.swapCalls,
      targetCalls: quote.targetCalls,
      fees: quote.fees,
      details: {
        bridge: quote.details.bridge,
        swapDestination: quote.details.swapDestination,
      },
    };

    const order = orderBuilderService.createStubOrder({
      sender,
      initData,
      srcChainId: targetChainId,
      paymentNonce,
      targetChainId,
      executionNonce,
      targetCalls,
      bridgeType,
      routesQuote: [syntheticRoute],
    });

    const deduplicatedTokens = deduplicateTokensByHigherAmount([
      ...targetTokens,
      ...sameChainTokens,
    ]);

    const { gasCost, gasPrice } = await chainService.estimateSrcGas(
      order,
      deduplicatedTokens
    );

    return { order, gasCost, gasPrice, quote };
  }

  /**
   * Fetch quotes for same-chain and cross-chain groups.
   * Same-chain: single getQuoteMultiInput for all tokens.
   * Cross-chain: getSwapRoute independently per source chain.
   */
  private async fetchRouteQuotesForGroups(params: {
    sameChainTokens: TokenWithAmount[];
    crossChainGroups: ChainTokenGroup[];
    targetTokens: TargetToken[];
    targetChainId: bigint;
    bridgeType: BridgeType;
    sender: Address;
    initData: Hex;
    executionNonce: bigint;
    targetCalls: TargetCall[];
  }): Promise<{
    sameChainQuoteResult: SameChainQuoteResult | null;
    crossChainRouteQuotes: ChainRouteQuote[];
  }> {
    const {
      sameChainTokens,
      crossChainGroups,
      targetTokens,
      targetChainId,
      bridgeType,
      sender,
      initData,
      executionNonce,
      targetCalls,
    } = params;

    const [sameChainQuoteResult, crossChainRouteQuotes] = await Promise.all([
      this.fetchSameChainQuote({
        sameChainTokens,
        targetTokens,
        targetChainId,
        bridgeType,
        sender,
        initData,
        executionNonce,
        targetCalls,
      }),
      Promise.all(
        crossChainGroups.map(async (chainGroup): Promise<ChainRouteQuote> => {
          const [routeResponse, paymentNonce] = await Promise.all([
            quoterClient.getSwapRoute({
              inputTokens: chainGroup.tokens.map((t) => t.address),
              originChainId: Number(chainGroup.chainId),
              outputTokens: targetTokens,
              destinationChainId: Number(targetChainId),
              bridgeType,
              depositor: sender,
              recipient: sender,
            }),
            chainService.getPaymentNonce(chainGroup.chainId, sender),
          ]);

          const order = orderBuilderService.createStubOrder({
            sender,
            initData,
            srcChainId: chainGroup.chainId,
            paymentNonce,
            targetChainId,
            executionNonce,
            targetCalls,
            bridgeType,
            routesQuote: routeResponse.routes,
          });
          const { gasCost, gasPrice } =
            await chainService.estimateSrcGas(order);

          return {
            chainId: chainGroup.chainId,
            tokens: chainGroup.tokens,
            routes: routeResponse.routes,
            order,
            srcGasCost: gasCost,
            srcGasPrice: gasPrice,
          };
        })
      ),
    ]);

    return { sameChainQuoteResult, crossChainRouteQuotes };
  }

  /**
   * Prepare orders that bridge source tokens to meet target token requirements.
   *
   * Separates same-chain and cross-chain processing:
   * - Same-chain tokens use a pre-fetched quote directly (no cross-chain before)
   *   or re-quote with adjusted targets (after cross-chain output)
   * - Cross-chain tokens get reduced targets based on accumulated output
   * - Tokens on the same source chain are combined via re-quoting
   *
   * TODO: pass gasTokens used for inputTokens to quoter to reduce MultiInputQuote api calls
   * TODO: automatically infer target tokens from targetCalls
   * TODO: estimate bridge amount from the gas in the quote
   *   - same chain token need swap -> affect all previous cross-chain swap
   */
  async prepareOrder(
    params: PrepareOrderRequest
  ): Promise<PrepareOrderResponse> {
    const {
      sender,
      initData,
      targetChainId,
      targetTokens,
      targetCalls,
      srcTokens,
      bridgeType = 'CCTP',
    } = params;

    const executionNonce = await chainService.getExecutionNonce(
      targetChainId,
      sender
    );

    if (targetTokens.length === 0) {
      return this.prepareGasOnlyOrder({
        sender,
        initData,
        targetChainId,
        targetCalls,
        srcTokens,
        executionNonce,
      });
    }

    // Step 1: Resolve token balances for all source tokens
    const resolvedTokens = await this.resolveTokenBalances(srcTokens, sender);

    // Step 2: Collect all same-chain tokens and cross-chain groups
    const allSameChainTokens: TokenWithAmount[] = srcTokens
      .filter((t) => t.chainId === targetChainId)
      .map((t) => resolvedTokens.get(`${t.chainId}:${t.address}`))
      .filter((t): t is TokenWithAmount => t != null && t.amount > 0n);

    const crossChainGroups = buildCrossChainGroups(
      srcTokens,
      targetChainId,
      resolvedTokens
    );

    // Step 3: Fetch same-chain quote and cross-chain route quotes in parallel
    const { sameChainQuoteResult, crossChainRouteQuotes } =
      await this.fetchRouteQuotesForGroups({
        sameChainTokens: allSameChainTokens,
        crossChainGroups,
        targetTokens,
        targetChainId,
        bridgeType,
        sender,
        initData,
        executionNonce,
        targetCalls,
      });

    const crossChainQuoteMap = new Map<bigint, ChainRouteQuote>(
      crossChainRouteQuotes.map((cq) => [cq.chainId, cq])
    );

    const targetAmountByToken = new Map<Address, bigint>(
      targetTokens.map((token) => [token.address, BigInt(token.amount)])
    );

    // Step 4: Iterate srcTokens in user-provided order
    let sameChainOrder: Order | null = null;
    let sameChainInputTokens: TokenWithAmount[] = [];
    let sameChainOutputTokens: TokenWithAmount[] = [];
    let sameChainProcessedInCurrentRun = false;
    let crossChainStates = new Map<bigint, ChainOrderState>();
    let accumulatedOutputByToken = new Map<Address, bigint>();
    let sameChainSwapExecutions: ExecutionCall[] = [];
    let sameChainUnpaidGas:
      { remainingGasInNative: bigint; lastInputToken: Address } | undefined;

    for (const srcToken of srcTokens) {
      const resolvedToken = resolvedTokens.get(
        `${srcToken.chainId}:${srcToken.address}`
      );
      if (!resolvedToken || resolvedToken.amount <= 0n) continue;

      if (srcToken.chainId === targetChainId) {
        let isSameChainGasPaid = false;
        // ── Same-chain token ──────────────────────────────────────────
        if (sameChainProcessedInCurrentRun) continue;
        sameChainProcessedInCurrentRun = true;

        if (!sameChainQuoteResult) continue;

        if (crossChainStates.size === 0) {
          // No cross-chain before: use pre-fetched quote, calculate payment from gas
          const remainingSameChainTokens = allSameChainTokens
            .map((token) => {
              const consumed = sameChainQuoteResult.quote.inputTokens.find(
                (t) => isAddressEqual(t.address, token.address)
              );
              return {
                address: token.address,
                amount: token.amount - BigInt(consumed?.amount ?? 0n),
              };
            })
            .filter((t) => t.amount > 0n);

          const { paymentTokens, isGasPaid, remainingGasInNative } =
            await calculatePaymentTokensFromGas(
              remainingSameChainTokens,
              sameChainQuoteResult.gasCost,
              targetChainId
            );
          isSameChainGasPaid = isGasPaid;
          if (!isGasPaid) {
            const lastInputToken =
              sameChainQuoteResult.quote.inputTokens.at(-1)!;
            sameChainUnpaidGas = {
              remainingGasInNative,
              lastInputToken: lastInputToken.address,
            };
          }

          const order = orderBuilderService.buildOrderFromQuote(
            sameChainQuoteResult.order,
            sameChainQuoteResult.quote,
            paymentTokens,
            targetCalls
          );
          sameChainSwapExecutions = encodeExecutionCall(
            sameChainQuoteResult.quote.targetCalls
          );

          const allInputByAddress = new Map<Address, bigint>();
          for (const t of sameChainQuoteResult.quote.inputTokens) {
            allInputByAddress.set(
              t.address,
              (allInputByAddress.get(t.address) ?? 0n) + BigInt(t.amount)
            );
          }
          for (const p of paymentTokens) {
            allInputByAddress.set(
              p.token,
              (allInputByAddress.get(p.token) ?? 0n) + p.amount
            );
          }
          const inputTokens = Array.from(allInputByAddress.entries()).map(
            ([address, amount]) => ({ address, amount })
          );

          const outputTokens = sameChainQuoteResult.quote.outputTokens.map(
            (t) => ({
              address: t.address,
              amount: BigInt(t.amount),
            })
          );

          sameChainOrder = order;
          sameChainInputTokens = inputTokens;
          sameChainOutputTokens = outputTokens;
          accumulatedOutputByToken = mergeOutputTokens(
            accumulatedOutputByToken,
            outputTokens
          );
        } else {
          // Cross-chain before: quote same-chain swap only (no same-chain order needed)
          if (sameChainOrder) {
            accumulatedOutputByToken = subtractOutputTokens(
              accumulatedOutputByToken,
              sameChainOutputTokens
            );
          }

          const unfilledOutputTokens = computeUnfilledOutputTokens(
            targetAmountByToken,
            accumulatedOutputByToken
          );

          const quote = await quoterClient.getQuoteMultiInput({
            depositor: sender,
            recipient: sender,
            originChainId: Number(targetChainId),
            destinationChainId: Number(targetChainId),
            inputTokens: allSameChainTokens,
            outputTokens: unfilledOutputTokens,
            bridgeType,
          });

          sameChainSwapExecutions = encodeExecutionCall(quote.targetCalls);

          const inputTokens = quote.inputTokens.map((t) => ({
            address: t.address,
            amount: BigInt(t.amount),
          }));

          const outputTokens = quote.outputTokens.map((t) => ({
            address: t.address,
            amount: BigInt(t.amount),
          }));

          sameChainOrder = null;
          sameChainInputTokens = inputTokens;
          sameChainOutputTokens = outputTokens;
          accumulatedOutputByToken = mergeOutputTokens(
            accumulatedOutputByToken,
            outputTokens
          );
          isSameChainGasPaid = true;
        }

        if (
          isSameChainGasPaid &&
          isEnoughOutputTokens(targetAmountByToken, accumulatedOutputByToken)
        ) {
          const allOrders = [
            ...(crossChainStates.size === 0 && sameChainOrder
              ? [sameChainOrder]
              : []),
            ...Array.from(crossChainStates.values()).map((s) =>
              prependUniqueExecutions(s.order, sameChainSwapExecutions)
            ),
          ];
          const { inputTokens: allInputTokens, outputTokens: allOutputTokens } =
            collectQuotedTokens({
              targetChainId,
              sameChainInputTokens,
              sameChainOutputTokens,
              crossChainStates,
            });
          return {
            orders: unifyTargetExecutions(
              updateValidationsWithTotalAmount(allOrders),
              targetCalls
            ),
            inputTokens: allInputTokens,
            outputTokens: allOutputTokens,
          };
        }
      } else {
        // ── Cross-chain token ─────────────────────────────────────────
        sameChainProcessedInCurrentRun = false;
        const chainQuote = crossChainQuoteMap.get(srcToken.chainId);
        if (!chainQuote) continue;

        const routeIdx = chainQuote.routes.findIndex((r) =>
          isAddressEqual(r.inputToken, srcToken.address)
        );
        if (routeIdx === -1) continue;

        const existingState = crossChainStates.get(srcToken.chainId);

        if (existingState) {
          // Same source chain — combine tokens and re-quote
          const rollbackAccumulated = accumulatedOutputByToken;
          accumulatedOutputByToken = subtractOutputTokens(
            accumulatedOutputByToken,
            existingState.outputTokens
          );

          const combinedRoutes = [
            ...existingState.routes,
            chainQuote.routes[routeIdx]!,
          ];
          const combinedRouteIdx = combinedRoutes.length - 1;

          const unfilledOutputTokens = computeUnfilledOutputTokens(
            targetAmountByToken,
            accumulatedOutputByToken
          );

          if (unfilledOutputTokens.length === 0) {
            // Gas-only: replace existing order with LZ message-only order
            const { paymentTokens, isGasPaid } =
              await calculatePaymentTokensFromGas(
                chainQuote.tokens,
                chainQuote.srcGasCost,
                srcToken.chainId
              );

            if (!isGasPaid) {
              accumulatedOutputByToken = rollbackAccumulated;
              continue;
            }

            const gasOnlyOrder = orderBuilderService.createGasOnlyLZOrder({
              sender,
              initData,
              srcChainId: srcToken.chainId,
              paymentNonce: chainQuote.order.srcIntent.nonce,
              targetChainId,
              executionNonce,
              targetCalls,
              paymentTokens,
            });

            const gasOnlyInputTokens = paymentTokens.map((p) => ({
              address: p.token,
              amount: p.amount,
            }));

            crossChainStates = new Map([
              ...crossChainStates,
              [
                srcToken.chainId,
                {
                  ...existingState,
                  order: gasOnlyOrder,
                  routes: [],
                  inputTokens: gasOnlyInputTokens,
                  outputTokens: [],
                },
              ],
            ]);

            if (
              isEnoughOutputTokens(
                targetAmountByToken,
                accumulatedOutputByToken
              )
            ) {
              const allOrders = Array.from(crossChainStates.values()).map((s) =>
                prependUniqueExecutions(s.order, sameChainSwapExecutions)
              );
              const {
                inputTokens: allInputTokens,
                outputTokens: allOutputTokens,
              } = collectQuotedTokens({
                targetChainId,
                sameChainInputTokens,
                sameChainOutputTokens,
                crossChainStates,
              });
              return {
                orders: unifyTargetExecutions(
                  updateValidationsWithTotalAmount(allOrders),
                  targetCalls
                ),
                inputTokens: allInputTokens,
                outputTokens: allOutputTokens,
              };
            }

            continue;
          }

          const result = await this.processQuote({
            order: existingState.stubOrder,
            route: combinedRoutes[combinedRouteIdx]!,
            routeIdx: combinedRouteIdx,
            sortedRoutes: combinedRoutes,
            chainTokens: chainQuote.tokens,
            srcGasCost: existingState.srcGasCost,
            srcGasPrice: existingState.srcGasPrice,
            unfilledOutputTokens,
            targetCalls,
            bridgeType,
          });

          if (!result) {
            accumulatedOutputByToken = rollbackAccumulated;
            continue;
          }

          crossChainStates = new Map([
            ...crossChainStates,
            [
              srcToken.chainId,
              {
                ...existingState,
                order: result.order,
                routes: combinedRoutes,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
              },
            ],
          ]);

          accumulatedOutputByToken = mergeOutputTokens(
            accumulatedOutputByToken,
            result.outputTokens
          );
        } else {
          // New cross-chain
          const unfilledOutputTokens = computeUnfilledOutputTokens(
            targetAmountByToken,
            accumulatedOutputByToken
          );

          if (unfilledOutputTokens.length === 0) {
            // TODO: gas fee and layerzero fee to relayer
            const { paymentTokens, isGasPaid } =
              await calculatePaymentTokensFromGas(
                chainQuote.tokens,
                chainQuote.srcGasCost,
                srcToken.chainId
              );

            if (!isGasPaid) continue;

            const gasOnlyOrder = orderBuilderService.createGasOnlyLZOrder({
              sender,
              initData,
              srcChainId: srcToken.chainId,
              paymentNonce: chainQuote.order.srcIntent.nonce,
              targetChainId,
              executionNonce,
              targetCalls,
              paymentTokens,
            });

            const gasOnlyInputTokens = paymentTokens.map((p) => ({
              address: p.token,
              amount: p.amount,
            }));

            crossChainStates = new Map([
              ...crossChainStates,
              [
                srcToken.chainId,
                {
                  chainId: srcToken.chainId,
                  order: gasOnlyOrder,
                  tokens: chainQuote.tokens,
                  routes: [],
                  inputTokens: gasOnlyInputTokens,
                  outputTokens: [],
                  srcGasCost: chainQuote.srcGasCost,
                  srcGasPrice: chainQuote.srcGasPrice,
                  stubOrder: chainQuote.order,
                },
              ],
            ]);

            if (
              isEnoughOutputTokens(
                targetAmountByToken,
                accumulatedOutputByToken
              )
            ) {
              const allOrders = Array.from(crossChainStates.values()).map((s) =>
                prependUniqueExecutions(s.order, sameChainSwapExecutions)
              );
              const {
                inputTokens: allInputTokens,
                outputTokens: allOutputTokens,
              } = collectQuotedTokens({
                targetChainId,
                sameChainInputTokens,
                sameChainOutputTokens,
                crossChainStates,
              });
              return {
                orders: unifyTargetExecutions(
                  updateValidationsWithTotalAmount(allOrders),
                  targetCalls
                ),
                inputTokens: allInputTokens,
                outputTokens: allOutputTokens,
              };
            }

            continue;
          }

          const route = chainQuote.routes[routeIdx]!;
          const result = await this.processQuote({
            order: chainQuote.order,
            route,
            routeIdx: 0,
            sortedRoutes: [route],
            chainTokens: chainQuote.tokens,
            srcGasCost: chainQuote.srcGasCost,
            srcGasPrice: chainQuote.srcGasPrice,
            unfilledOutputTokens,
            targetCalls,
            bridgeType,
          });

          if (!result) continue;

          crossChainStates = new Map([
            ...crossChainStates,
            [
              srcToken.chainId,
              {
                chainId: srcToken.chainId,
                order: result.order,
                tokens: chainQuote.tokens,
                routes: [route],
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                srcGasCost: chainQuote.srcGasCost,
                srcGasPrice: chainQuote.srcGasPrice,
                stubOrder: chainQuote.order,
              },
            ],
          ]);

          accumulatedOutputByToken = mergeOutputTokens(
            accumulatedOutputByToken,
            result.outputTokens
          );
        }

        if (
          isEnoughOutputTokens(targetAmountByToken, accumulatedOutputByToken)
        ) {
          const allOrders = Array.from(crossChainStates.values()).map((s) =>
            prependUniqueExecutions(s.order, sameChainSwapExecutions)
          );
          const { inputTokens: allInputTokens, outputTokens: allOutputTokens } =
            collectQuotedTokens({
              targetChainId,
              sameChainInputTokens,
              sameChainOutputTokens,
              crossChainStates,
            });
          return {
            orders: unifyTargetExecutions(
              updateValidationsWithTotalAmount(allOrders),
              targetCalls
            ),
            inputTokens: allInputTokens,
            outputTokens: allOutputTokens,
          };
        }
      }
    }

    // Same-chain only and gas not fully paid — throw gas-specific error
    if (sameChainUnpaidGas && crossChainStates.size === 0) {
      const [unpaidInToken, { decimals }] = await Promise.all([
        convertTokenAmount(
          Number(targetChainId),
          NATIVE_TOKEN,
          sameChainUnpaidGas.lastInputToken,
          sameChainUnpaidGas.remainingGasInNative
        ),
        chainService.getTokenInfo(
          targetChainId,
          sameChainUnpaidGas.lastInputToken,
          sender
        ),
      ]);
      throw new InsufficientGasError(
        sameChainUnpaidGas.lastInputToken,
        unpaidInToken,
        formatUnits(unpaidInToken, decimals)
      );
    }

    // All tokens exhausted without meeting target — throw error
    throw new InsufficientOutputError(
      accumulatedOutputByToken,
      targetAmountByToken
    );
  }

  /**
   * Prepare gas-only orders when targetTokens is empty.
   * No bridging/swapping — just pays gas to execute targetCalls on targetChainId.
   *
   * Iterates srcTokens in user-provided order, accumulating tokens per source chain.
   * At each token, attempts to build a gas-only order with the accumulated tokens
   * for that chain. Stops as soon as gas is successfully paid.
   */
  private async prepareGasOnlyOrder(params: {
    sender: Address;
    initData: Hex;
    targetChainId: bigint;
    targetCalls: TargetCall[];
    srcTokens: SrcToken[];
    executionNonce: bigint;
  }): Promise<PrepareOrderResponse> {
    const {
      sender,
      initData,
      targetChainId,
      targetCalls,
      srcTokens,
      executionNonce,
    } = params;

    const resolvedTokens = await this.resolveTokenBalances(srcTokens, sender);

    // Accumulate resolved tokens per source chain as we iterate
    const accumulatedByChain = new Map<bigint, TokenWithAmount[]>();

    for (const srcToken of srcTokens) {
      const resolved = resolvedTokens.get(
        `${srcToken.chainId}:${srcToken.address}`
      );
      if (!resolved || resolved.amount <= 0n) continue;

      const existing = accumulatedByChain.get(srcToken.chainId) ?? [];
      const chainTokens = [...existing, resolved];
      accumulatedByChain.set(srcToken.chainId, chainTokens);

      const isSameChain = srcToken.chainId === targetChainId;

      const result = isSameChain
        ? await this.buildGasOnlySameChainOrder({
            sender,
            initData,
            chainId: targetChainId,
            executionNonce,
            targetCalls,
            chainTokens,
          })
        : await this.buildGasOnlyCrossChainOrder({
            sender,
            initData,
            srcChainId: srcToken.chainId,
            targetChainId,
            executionNonce,
            targetCalls,
            chainTokens,
          });

      if (result) {
        const inputTokens = result.inputTokens.map((t) => ({
          chainId: srcToken.chainId,
          address: t.address,
          amount: t.amount,
        }));

        return {
          orders: unifyTargetExecutions([result.order], targetCalls),
          inputTokens,
          outputTokens: [],
        };
      }
    }

    const triedChains = Array.from(accumulatedByChain.entries()).map(
      ([chainId, tokens]) => ({
        chainId,
        tokens: tokens.map((t) => ({ address: t.address, amount: t.amount })),
      })
    );
    throw new GasOnlyInsufficientFundsError(targetChainId, triedChains);
  }

  /**
   * Build a gas-only same-chain order using two-pass gas estimation.
   */
  private async buildGasOnlySameChainOrder(params: {
    sender: Address;
    initData: Hex;
    chainId: bigint;
    executionNonce: bigint;
    targetCalls: TargetCall[];
    chainTokens: TokenWithAmount[];
  }): Promise<{ order: Order; inputTokens: TokenWithAmount[] } | null> {
    const {
      sender,
      initData,
      chainId,
      executionNonce,
      targetCalls,
      chainTokens,
    } = params;

    const paymentNonce = await chainService.getPaymentNonce(chainId, sender);

    // Pass 1: stub order with empty payment tokens for gas estimation
    const stubOrder = orderBuilderService.createGasOnlySameChainOrder({
      sender,
      initData,
      chainId,
      paymentNonce,
      executionNonce,
      targetCalls,
      paymentTokens: [],
    });

    const { gasCost } = await chainService.estimateSrcGas(stubOrder);

    // Pass 2: calculate payment tokens from gas
    const { paymentTokens, isGasPaid } = await calculatePaymentTokensFromGas(
      chainTokens,
      gasCost,
      chainId
    );

    if (!isGasPaid) return null;

    // Pass 3: final order with actual payment tokens
    const order = orderBuilderService.createGasOnlySameChainOrder({
      sender,
      initData,
      chainId,
      paymentNonce,
      executionNonce,
      targetCalls,
      paymentTokens,
    });

    const inputTokens = paymentTokens.map((p) => ({
      address: p.token,
      amount: p.amount,
    }));

    return { order, inputTokens };
  }

  /**
   * Build a gas-only cross-chain order using LZ message bridging with two-pass gas estimation.
   */
  private async buildGasOnlyCrossChainOrder(params: {
    sender: Address;
    initData: Hex;
    srcChainId: bigint;
    targetChainId: bigint;
    executionNonce: bigint;
    targetCalls: TargetCall[];
    chainTokens: TokenWithAmount[];
  }): Promise<{ order: Order; inputTokens: TokenWithAmount[] } | null> {
    const {
      sender,
      initData,
      srcChainId,
      targetChainId,
      executionNonce,
      targetCalls,
      chainTokens,
    } = params;

    const paymentNonce = await chainService.getPaymentNonce(srcChainId, sender);

    // Pass 1: stub order with empty payment tokens for gas estimation
    const stubOrder = orderBuilderService.createGasOnlyLZOrder({
      sender,
      initData,
      srcChainId,
      paymentNonce,
      targetChainId,
      executionNonce,
      targetCalls,
      paymentTokens: [],
    });

    const { gasCost } = await chainService.estimateSrcGas(
      stubOrder,
      undefined,
      [{ address: LAYERZERO_ADAPTER, balance: String(LZ_DEFAULT_NATIVE_FEE) }]
    );

    // Pass 2: calculate payment tokens from gas
    const { paymentTokens, isGasPaid } = await calculatePaymentTokensFromGas(
      chainTokens,
      gasCost,
      srcChainId
    );

    if (!isGasPaid) return null;

    // Pass 3: final order with actual payment tokens
    const order = orderBuilderService.createGasOnlyLZOrder({
      sender,
      initData,
      srcChainId,
      paymentNonce,
      targetChainId,
      executionNonce,
      targetCalls,
      paymentTokens,
    });

    const inputTokens = paymentTokens.map((p) => ({
      address: p.token,
      amount: p.amount,
    }));

    return { order, inputTokens };
  }

  /**
   * Submit multiple signed orders atomically as a batch
   * Orders are validated via contract simulation before submission
   * All orders must pass validation or the entire batch is rejected
   * Orders are published to RabbitMQ for processing by graviton-relayer
   */
  async submitSignedOrders(
    signedOrders: Order[]
  ): Promise<SubmitOrderResponse> {
    const validationErrors: Array<{ error: string; orderHash: Hex }> = [];
    const validatedOrders: Array<{
      order: Order;
      orderHash: Hex;
    }> = [];

    for (const signedOrder of signedOrders) {
      const orderHash = this.getOrderHash(signedOrder);

      try {
        await chainService.validateOrder(
          signedOrder,
          signedOrder.srcIntent.chainId
        );

        validatedOrders.push({
          order: signedOrder,
          orderHash,
        });
      } catch (error) {
        validationErrors.push({
          orderHash,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (validationErrors.length > 0) {
      const errorMessage = validationErrors
        .map((e) => `${e.orderHash}: ${e.error}`)
        .join('; ');
      throw new Error(`Batch validation failed: ${errorMessage}`);
    }

    await queuePublisher.publishOrder({ orders: signedOrders });

    return {
      targetChainId: serializeBigInt(signedOrders[0]!.targetIntent.chainId),
      orderHashes: validatedOrders.map((o) => ({
        orderHash: o.orderHash,
        chainId: serializeBigInt(o.order.srcIntent.chainId),
      })),
    };
  }

  getOrderHash(order: Order): Hex {
    const {
      sender,
      openDeadline,
      fillDeadline,
      initData,
      targetIntent,
      srcIntent,
    } = order;

    return keccak256(
      encodeAbiParameters(
        [
          { name: 'sender', type: 'address' },
          { name: 'openDeadline', type: 'uint32' },
          { name: 'fillDeadline', type: 'uint32' },
          { name: 'initData', type: 'bytes' },
          {
            name: 'targetIntent',
            type: 'tuple',
            components: [
              {
                name: 'nonce',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'chainId',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'validations',
                type: 'tuple[]',
                internalType: 'struct ValidationCall[]',
                components: [
                  {
                    name: 'validator',
                    type: 'address',
                    internalType: 'contract IInteropValidator',
                  },
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'executions',
                type: 'tuple[]',
                internalType: 'struct ExecutionCall[]',
                components: [
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                  {
                    name: 'mode',
                    type: 'bytes32',
                    internalType: 'bytes32',
                  },
                ],
              },
            ],
          },
          {
            name: 'srcIntent',
            type: 'tuple',
            components: [
              {
                name: 'chainId',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'nonce',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'paymentTokens',
                type: 'tuple[]',
                internalType: 'struct PaymentToken[]',
                components: [
                  {
                    name: 'recipient',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'token',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'amount',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                ],
              },
              {
                name: 'preHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  {
                    name: 'to',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'value',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'postHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  {
                    name: 'to',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'value',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'adapter',
                type: 'address',
                internalType: 'contract IAdapter',
              },
              {
                name: 'adapterData',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
        ],
        [sender, openDeadline, fillDeadline, initData, targetIntent, srcIntent]
      )
    );
  }

  /**
   * Get order open receipt (transaction receipt for OrderOpened event)
   */
  async getOrderOpenReceipt(
    orderHash: Hex,
    chainId: bigint,
    interopExecutor?: Address
  ) {
    return await chainService.getOrderOpenReceipt(
      orderHash,
      chainId,
      interopExecutor
    );
  }

  /**
   * Get order fill receipt (transaction receipt for OrderFilled event)
   */
  async getOrderFillReceipt(
    orderHash: Hex,
    chainId: bigint,
    interopExecutor?: Address
  ) {
    return await chainService.getOrderFillReceipt(
      orderHash,
      chainId,
      interopExecutor
    );
  }
}
