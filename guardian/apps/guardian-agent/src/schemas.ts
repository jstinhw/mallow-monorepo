import { z } from "zod";
import { typedDataSchema } from "./eip712/schema";

export const checkBodySchema = z.object({
  chainId: z.number().int().positive(),
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  value: z.string().regex(/^(0|[1-9][0-9]*)$/),
  data: z.string().regex(/^0x[0-9a-fA-F]*$/),
  // EIP-712 typed data for an `eth_signTypedData_v4` request, validated against
  // the spec structure (see ./eip712/schema).
  typedData: typedDataSchema.optional(),
});
