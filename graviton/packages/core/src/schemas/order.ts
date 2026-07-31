import { z } from 'zod';
import { AddressSchema, HexSchema, CallSchema } from './commons.js';

/**
 * PaymentToken struct
 * Represents a payment token to be transferred as part of the order
 */
export const PaymentTokenSchema = z.object({
  recipient: AddressSchema,
  token: AddressSchema,
  amount: z.bigint(),
});

/**
 * ValidationCall struct
 * Represents a validation that must be satisfied before execution
 */
export const ValidationCallSchema = z.object({
  validator: AddressSchema,
  data: HexSchema,
});

/**
 * ExecutionCall struct
 * Represents an execution call to be made after validation
 */
export const ExecutionCallSchema = z.object({
  data: HexSchema,
  mode: HexSchema,
});

/**
 * SrcIntent struct
 * Represents the source chain intent including bridge and payment details
 */
export const SrcIntentSchema = z.object({
  chainId: z.bigint(),
  nonce: z.bigint(),
  paymentTokens: z.array(PaymentTokenSchema),
  preHooks: z.array(CallSchema),
  postHooks: z.array(CallSchema),
  token: AddressSchema,
  amount: z.bigint(),
  adapter: AddressSchema,
  adapterData: HexSchema,
});

/**
 * TargetIntent struct
 * Represents the target chain intent including validations and executions
 */
export const TargetIntentSchema = z.object({
  nonce: z.bigint(),
  chainId: z.bigint(),
  token: AddressSchema,
  amount: z.bigint(),
  validations: z.array(ValidationCallSchema),
  executions: z.array(ExecutionCallSchema),
});

export type TargetIntent = z.infer<typeof TargetIntentSchema>;

/**
 * Order struct
 * Main order structure matching the Solidity InteropExecutor contract
 */
export const OrderSchema = z.object({
  sender: AddressSchema,
  openDeadline: z.number().int().nonnegative(),
  fillDeadline: z.number().int().nonnegative(),
  initData: HexSchema,
  targetIntent: TargetIntentSchema,
  srcIntent: SrcIntentSchema,
  signature: HexSchema,
});
