import { z } from 'zod';
import {
  OrderSchema,
  AddressSchema,
  HexSchema,
  BigIntSchema,
} from '@graviton/core';

export const TargetCallSchema = z.object({
  data: HexSchema,
  mode: HexSchema,
});

export const SrcTokenSchema = z.object({
  chainId: BigIntSchema,
  address: AddressSchema,
  amount: BigIntSchema.optional().default(0n),
});

export const TargetTokenSchema = z.object({
  address: AddressSchema,
  amount: BigIntSchema,
});

export const prepareOrderRequestSchema = z.object({
  sender: AddressSchema,
  initData: HexSchema,
  targetChainId: BigIntSchema,
  targetTokens: z.array(TargetTokenSchema).optional().default([]),
  targetCalls: z.array(TargetCallSchema),
  srcTokens: z.array(SrcTokenSchema),
  bridgeType: z.enum(['CCTP', 'ACROSS']).optional(),
});

const ChainTokenWithAmountSchema = z.object({
  chainId: BigIntSchema,
  address: AddressSchema,
  amount: BigIntSchema,
});

export const prepareOrderResponseSchema = z.object({
  orders: z.array(OrderSchema),
  inputTokens: z.array(ChainTokenWithAmountSchema),
  outputTokens: z.array(ChainTokenWithAmountSchema),
});

export type PrepareOrderRequest = z.infer<typeof prepareOrderRequestSchema>;
export type PrepareOrderResponse = z.infer<typeof prepareOrderResponseSchema>;
