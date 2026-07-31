import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  env: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3001),
  rabbitmq: z.object({
    url: z.string().url(),
  }),
  worker: z.object({
    concurrency: z.coerce.number().default(5),
  }),
  blockchain: z.object({
    chainId: z.coerce.number(),
    relayerPrivateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
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
  worker: {
    concurrency: process.env.WORKER_CONCURRENCY,
  },
  blockchain: {
    chainId: 1,
    relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY,
  },
  log: {
    level: process.env.LOG_LEVEL,
  },
});

export type Config = z.infer<typeof ConfigSchema>;
