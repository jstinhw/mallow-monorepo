import { WorkerConsumer } from './worker/consumer.js';
import { createLogger } from '@graviton/core';
import { config } from './config/index.js';

const logger = createLogger('worker', config.log.level);

async function start() {
  try {
    const worker = new WorkerConsumer();
    await worker.start();

    logger.info('Worker started successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to start worker');
    process.exit(1);
  }
}

start();
