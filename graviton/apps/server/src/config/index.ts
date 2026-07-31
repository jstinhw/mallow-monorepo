import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  env: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  rabbitmq: z.object({
    url: z.string().url(),
  }),
  services: z.object({
    quoterUrl: z.string().url(),
    relayerUrl: z.string().url(),
  }),
  order: z.object({
    expiryMinutes: z.coerce.number().default(15),
  }),
  log: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
});

export const config = ConfigSchema.parse({
  env: process.env.NODE_ENV,
  port: process.env.PORT,
  rabbitmq: {
    url: process.env.RABBITMQ_URL,
  },
  services: {
    quoterUrl: process.env.QUOTER_URL,
    relayerUrl: process.env.RELAYER_URL,
  },
  order: {
    expiryMinutes: process.env.ORDER_EXPIRY_MINUTES,
  },
  log: {
    level: process.env.LOG_LEVEL,
  },
});

export type Config = z.infer<typeof ConfigSchema>;
