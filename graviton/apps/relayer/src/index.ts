import { buildApp } from './app.js';
import { config } from './config/index.js';
import { createLogger } from '@graviton/core';

const logger = createLogger('relayer-api', config.log.level);

async function start() {
  try {
    const app = await buildApp();

    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    logger.info(`API server listening on port ${config.port}`);
    logger.info(`Environment: ${config.env}`);
  } catch (error) {
    logger.error({ error }, 'Failed to start API server');
    process.exit(1);
  }
}

start();
