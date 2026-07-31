import { z } from 'zod';
import type { Address, Call } from 'viem';
import {
  AddressSchema,
  BigIntSchema,
  HexSchema,
  NumericSchema,
  CallSchema,
} from '../schemas/commons.js';
import {
  BRIDGE_TYPES,
  defaultSenderAddress,
  SWAP_TYPES,
} from '../constants/quote.js';
import { QuoteFee, QuoteDetailItem, TokenWithAmount } from '../types/quotes.js';

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------
export const TokenWithAmountSchema = z.object({
  address: AddressSchema,
  amount: BigIntSchema,
});

/**
 * POST /v1/quote
 */
export const quoteRequestSchema = z.object({
  // optional to get quote without sender
  depositor: AddressSchema.optional().default(defaultSenderAddress),
  recipient: AddressSchema.optional().default(defaultSenderAddress),
  refundRecipient: AddressSchema.optional().default(defaultSenderAddress),
  // quote tokens/chains
  originChainId: NumericSchema,
  destinationChainId: NumericSchema,
  inputToken: AddressSchema,
  outputToken: AddressSchema,
  amount: BigIntSchema.refine(
    (amount) => amount > 0n,
    'Amount must be positive'
  ),
  swapType: z.enum(SWAP_TYPES),
  slippage: NumericSchema.optional(),
  calls: z.array(CallSchema).optional(),
  // bridge selection, use the quote with lowest fee if not specified
  bridgeType: z.enum(BRIDGE_TYPES).optional(),
  // across specific fields
  message: HexSchema.optional(),
  integratorId: HexSchema.optional(),
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export interface QuoteResponse {
  id: string;
  amount: bigint;
  approvalCalls: Call[];
  swapCalls: Call[];
  fees: {
    totalUsd?: string;
    details: QuoteFee[];
  };
  details: {
    swapOrigin?: QuoteDetailItem;
    bridge: QuoteDetailItem;
    swapDestination?: QuoteDetailItem;
  };
}

/**
 * POST /v1/quote/multi-input
 */
export const multiInputQuoteRequestSchema = z.object({
  depositor: AddressSchema,
  recipient: AddressSchema,
  originChainId: z.coerce.number(),
  destinationChainId: z.coerce.number(),
  inputTokens: z.array(TokenWithAmountSchema).min(1),
  outputTokens: z.array(TokenWithAmountSchema).min(1),
  slippage: z.coerce.number().optional(),
  calls: z.array(CallSchema).optional(),
  bridgeType: z.enum(['CCTP', 'ACROSS', 'RELAY']),
  message: HexSchema.optional(),
  refundRecipient: AddressSchema.optional(),
});

export type MultiInputQuoteRequest = z.infer<
  typeof multiInputQuoteRequestSchema
>;

export interface MultiInputQuoteResponse {
  id: string;
  inputTokens: TokenWithAmount[];
  outputTokens: TokenWithAmount[];
  approvalCalls: Call[];
  swapCalls: Call[];
  targetCalls: Call[];
  fees: {
    totalUsd?: string;
    details: QuoteFee[];
  };
  details: {
    swapOrigin: QuoteDetailItem[];
    bridge: QuoteDetailItem;
    swapDestination: QuoteDetailItem[];
  };
}

/**
 * POST /v1/quote/route
 */
export const swapRouteRequestSchema = z.object({
  inputTokens: z.array(AddressSchema).min(1),
  originChainId: z.coerce.number(),
  outputTokens: z.array(TokenWithAmountSchema).min(1),
  destinationChainId: z.coerce.number(),
  bridgeType: z.enum(['CCTP', 'ACROSS', 'RELAY']),
  depositor: AddressSchema.optional(),
  recipient: AddressSchema.optional(),
  slippage: z.coerce.number().optional(),
});

export type SwapRouteRequest = z.infer<typeof swapRouteRequestSchema>;

export interface RouteQuote {
  inputToken: Address;
  inputAmount: bigint;
  srcCalls: Call[];
  swapCalls: Call[];
  targetCalls: Call[];
  fees: {
    totalUsd?: string;
    details: QuoteFee[];
  };
  details: {
    swapOrigin?: QuoteDetailItem;
    bridge: QuoteDetailItem;
    swapDestination: QuoteDetailItem[];
  };
}

export interface SwapRouteResponse {
  id: string;
  routes: RouteQuote[];
}

/**
 * GET /v1/quote/swap
 */
export const swapQuoteRequestSchema = z.object({
  account: AddressSchema,
  chainId: z.coerce.number(),
  inputToken: AddressSchema,
  outputToken: AddressSchema,
  amount: z.string().regex(/^\d+$/),
  type: z.enum(['exactInput', 'exactOutput']),
  slippageBps: z.coerce.number().optional(),
});

export type SwapQuoteRequest = z.infer<typeof swapQuoteRequestSchema>;

export interface SwapQuoteResponse {
  inputToken: Address;
  outputToken: Address;
  inputAmount: string;
  outputAmount: string;
  gasEstimate: string;
  calls: Call[];
}

/**
 * GET /v1/quote/bridge
 */
export const bridgeQuoteRequestSchema = z.object({
  srcChainId: z.coerce.number(),
  targetChainId: z.coerce.number(),
  srcToken: AddressSchema,
  targetToken: AddressSchema,
  amount: z.string().regex(/^\d+$/),
  bridgeType: z.enum(['CCTP', 'ACROSS']).optional(),
  depositor: AddressSchema.optional(),
  recipient: AddressSchema.optional(),
});

export type BridgeQuoteRequest = z.infer<typeof bridgeQuoteRequestSchema>;

export interface BridgeQuoteResponse {
  bps: string;
  gas: string;
}
