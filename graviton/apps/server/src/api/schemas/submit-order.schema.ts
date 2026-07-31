import { z } from 'zod';
import { JsonOrderSchema } from '@graviton/core';

export const submitOrderRequestSchema = z.object({
  orders: z.array(JsonOrderSchema).min(1).max(100),
});

export const submitOrderResponseSchema = z.object({
  targetChainId: z.string(),
  orderHashes: z.array(
    z.object({
      orderHash: z.string(),
      chainId: z.string(),
    })
  ),
});

export type SubmitOrderRequest = z.infer<typeof submitOrderRequestSchema>;
export type SubmitOrderResponse = z.infer<typeof submitOrderResponseSchema>;
