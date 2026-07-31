import { buildApp } from './app.js';
import { config } from './config/index.js';
import { createLogger } from '@graviton/core';

const logger = createLogger('quoter', config.log.level);

async function start() {
  try {
    const app = await buildApp();

    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    logger.info(`Quoter server listening on port ${config.port}`);
    logger.info(`Environment: ${config.env}`);
    logger.info(
      `Swagger docs available at http://localhost:${config.port}/docs`
    );
  } catch (error) {
    logger.error({ error }, 'Failed to start quoter server');
    process.exit(1);
  }
}

start();
