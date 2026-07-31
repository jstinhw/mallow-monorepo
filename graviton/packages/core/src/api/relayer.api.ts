import { z } from 'zod';
import { AddressSchema, BigIntSchema, HexSchema } from '../schemas/commons.js';
import { JsonOrderSchema } from '../schemas/rpc.js';

/**
 * Schema for state mapping (slot -> value)
 */
const stateMappingSchema = z.array(
  z.object({
    slot: HexSchema,
    value: HexSchema,
  })
);

/**
 * Schema for state override used in gas estimation
 * Matches viem's StateOverride type
 */
export const stateOverrideEntrySchema = z.object({
  address: AddressSchema,
  balance: z.string().regex(/^\d+$/).optional(),
  nonce: z.number().int().nonnegative().optional(),
  code: HexSchema.optional(),
  state: stateMappingSchema.optional(),
  stateDiff: stateMappingSchema.optional(),
});

export type StateOverrideEntry = z.infer<typeof stateOverrideEntrySchema>;

/**
 * Base gas estimate request with discriminated union for operation types
 */
const baseEstimateSchema = z.object({
  order: JsonOrderSchema,
  interopExecutor: AddressSchema,
  chainId: z.number().int().positive().optional(),
  stateOverrides: z.array(stateOverrideEntrySchema).optional(),
});

/**
 * Open operation - estimate gas for opening an order on source chain
 */
export const openGasEstimateSchema = baseEstimateSchema.extend({
  operation: z.literal('open'),
});

/**
 * Fill operation - estimate gas for filling an order on target chain
 */
export const fillGasEstimateSchema = baseEstimateSchema.extend({
  operation: z.literal('fill'),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+$/),
});

/**
 * Discriminated union of all gas estimate request types
 */
export const gasEstimateRequestSchema = z.discriminatedUnion('operation', [
  openGasEstimateSchema,
  fillGasEstimateSchema,
]);

/**
 * Common response schema for all gas estimates
 */
export const gasEstimateResponseSchema = z.object({
  gasUsed: BigIntSchema,
  gasCost: BigIntSchema,
  gasPrice: BigIntSchema,
});

export type OpenGasEstimateRequest = z.infer<typeof openGasEstimateSchema>;
export type FillGasEstimateRequest = z.infer<typeof fillGasEstimateSchema>;
export type GasEstimateRequest = z.infer<typeof gasEstimateRequestSchema>;
export type GasEstimateResponse = z.infer<typeof gasEstimateResponseSchema>;
