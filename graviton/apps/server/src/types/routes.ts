import {
  Order,
  RouteQuote,
  TokenWithAmount,
  MultiInputQuoteResponse,
} from '@graviton/core';

export type ChainTokenGroup = { chainId: bigint; tokens: TokenWithAmount[] };

export interface ChainRouteQuote {
  chainId: bigint;
  tokens: TokenWithAmount[];
  routes: RouteQuote[];
  order: Order;
  srcGasCost: bigint;
  srcGasPrice: bigint;
}

export interface SameChainQuoteResult {
  readonly order: Order;
  readonly gasCost: bigint;
  readonly gasPrice: bigint;
  readonly quote: MultiInputQuoteResponse;
}

export interface ChainOrderState {
  readonly chainId: bigint;
  readonly order: Order;
  readonly tokens: TokenWithAmount[];
  readonly routes: RouteQuote[];
  readonly inputTokens: TokenWithAmount[];
  readonly outputTokens: TokenWithAmount[];
  readonly srcGasCost: bigint;
  readonly srcGasPrice: bigint;
  readonly stubOrder: Order;
}
