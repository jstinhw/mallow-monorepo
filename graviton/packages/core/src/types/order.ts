import { z } from 'zod';
import type { Hex, Address } from 'viem';
import {
  PaymentTokenSchema,
  ValidationCallSchema,
  ExecutionCallSchema,
  CallSchema,
  SrcIntentSchema,
  OrderSchema,
  JsonOrderSchema,
} from '../schemas/index';

export type PaymentToken = z.infer<typeof PaymentTokenSchema>;

export type ValidationCall = z.infer<typeof ValidationCallSchema>;

export type ExecutionCall = z.infer<typeof ExecutionCallSchema>;

export type Call = z.infer<typeof CallSchema>;

export type SrcIntent = z.infer<typeof SrcIntentSchema>;

export type Order = z.infer<typeof OrderSchema>;

export type JsonOrder = z.input<typeof JsonOrderSchema>;

/**
 * Order status enum
 * Used for tracking order state in the database
 */
export enum OrderStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  OPENED = 'opened',
  FILLED = 'filled',
  EXPIRED = 'expired',
  FAILED = 'failed',
}

/**
 * Database order record
 */
export interface OrderRecord {
  id: bigint;
  orderHash: Hex;
  sender: Address;
  openDeadline: number;
  fillDeadline: number;
  srcChainId: bigint;
  targetChainId: bigint;
  status: OrderStatus;
  orderData: Order;
  batchId?: bigint;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Database order batch record
 */
export interface OrderBatchRecord {
  id: bigint;
  batchHash: Hex;
  orderCount: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}
