import { z } from 'zod';
import { JsonOrderSchema } from '../schemas/rpc.js';

/**
 * Schema for order batch messages sent through the queue
 */
export const orderBatchMessageSchema = z.object({
  orders: JsonOrderSchema.array(),
});

export type OrderBatchMessage = z.infer<typeof orderBatchMessageSchema>;
