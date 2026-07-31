import { z } from 'zod';
import { AddressSchema, BigIntSchema, HexSchema } from './commons.js';
import { ValidationCallSchema, ExecutionCallSchema } from './order.js';

/**
 * JSON-compatible PaymentToken schema
 */
const JsonPaymentTokenSchema = z.object({
  recipient: AddressSchema,
  token: AddressSchema,
  amount: BigIntSchema,
});

/**
 * JSON-compatible Call schema
 */
const JsonCallSchema = z.object({
  to: AddressSchema,
  value: BigIntSchema,
  data: HexSchema,
});

/**
 * JSON-compatible SrcIntent schema
 */
const JsonSrcIntentSchema = z.object({
  chainId: BigIntSchema,
  nonce: BigIntSchema,
  paymentTokens: z.array(JsonPaymentTokenSchema),
  preHooks: z.array(JsonCallSchema),
  postHooks: z.array(JsonCallSchema),
  token: AddressSchema,
  amount: BigIntSchema,
  adapter: AddressSchema,
  adapterData: HexSchema,
});

/**
 * JSON-compatible TargetIntent schema
 */
const JsonTargetIntentSchema = z.object({
  nonce: BigIntSchema,
  chainId: BigIntSchema,
  token: AddressSchema,
  amount: BigIntSchema,
  validations: z.array(ValidationCallSchema),
  executions: z.array(ExecutionCallSchema),
});

/**
 * JSON-compatible Order schema
 * Accepts JSON-friendly inputs (strings/numbers for bigint fields)
 * and automatically transforms them to the correct types
 *
 * Use this schema for API endpoints that receive JSON data
 */
export const JsonOrderSchema = z.object({
  sender: AddressSchema,
  openDeadline: z.number().int().nonnegative(),
  fillDeadline: z.number().int().nonnegative(),
  initData: HexSchema,
  targetIntent: JsonTargetIntentSchema,
  srcIntent: JsonSrcIntentSchema,
  signature: HexSchema,
});
