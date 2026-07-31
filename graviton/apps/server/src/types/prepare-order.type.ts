import { z } from 'zod';
import type {
  SrcTokenSchema,
  TargetTokenSchema,
  TargetCallSchema,
} from '../api/schemas/prepare-order.schema.js';

export type SrcToken = z.infer<typeof SrcTokenSchema>;
export type TargetToken = z.infer<typeof TargetTokenSchema>;
export type TargetCall = z.infer<typeof TargetCallSchema>;
