import { z } from 'zod';

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const bridgeQuoteSchema = {
  querystring: z.object({
    sourceChainId: z.coerce.number(),
    destinationChainId: z.coerce.number(),
    token: AddressSchema,
    amount: z.string().regex(/^\d+$/),
    bridgeType: z.enum(['across', 'cctp']),
    inputToken: AddressSchema.optional(),
    outputToken: AddressSchema.optional(),
    depositor: AddressSchema.optional(),
    recipient: AddressSchema.optional(),
  }),
} as const;
