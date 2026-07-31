import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  env: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3002),
  log: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
});

export const config = ConfigSchema.parse({
  env: process.env.NODE_ENV,
  port: process.env.PORT,
  log: {
    level: process.env.LOG_LEVEL,
  },
});

export type Config = z.infer<typeof ConfigSchema>;
