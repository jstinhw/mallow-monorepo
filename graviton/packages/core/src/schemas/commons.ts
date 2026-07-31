import { z } from 'zod';
import { isAddress, isHex, getAddress } from 'viem';

/**
 * Zod schema for Ethereum address validation
 */
export const AddressSchema = z
  .string()
  .refine(isAddress)
  .transform((val) => getAddress(val));

/**
 * Zod schema for bytes/hex data validation
 */
export const HexSchema = z.string().refine(isHex);

/**
 * JSON-compatible BigInt schema
 * Accepts string, number, or bigint and transforms to bigint
 * This is necessary because JSON doesn't support bigint natively
 */
export const BigIntSchema = z
  .union([
    z.string().regex(/^\d+$/),
    z.string().regex(/^0x[0-9a-fA-F]+$/),
    z.number().int().nonnegative(),
    z.bigint(),
  ])
  .transform((amount) => BigInt(amount));

/**
 * Zod schema for numeric validation
 */
export const NumericSchema = z.coerce.number().positive();

/**
 * Zod schema for call data validation
 */
export const CallSchema = z.object({
  to: AddressSchema,
  data: HexSchema,
  value: BigIntSchema,
});
