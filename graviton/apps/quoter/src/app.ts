import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config/index.js';
import { createLogger } from '@graviton/core';
import { registerRoutes } from './api/index.js';

const logger = createLogger('quoter', config.log.level);

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.log.level,
      transport:
        config.env === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  // Register plugins
  await app.register(cors);
  await app.register(helmet);

  // Swagger documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Graviton Quoter API',
        description:
          'Quote aggregation API for Uniswap swaps and Circle CCTP bridges',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${config.port}`,
          description: 'Development server',
        },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Register routes
  await registerRoutes(app);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    await app.close();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return app;
}
