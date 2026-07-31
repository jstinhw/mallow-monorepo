import type { Channel, ConsumeMessage } from 'amqplib';
import { createLogger } from '@graviton/core';
import { config } from '../config/index.js';

const logger = createLogger('retry-handler', config.log.level);

export class RetryHandler {
  private maxRetries = 3;
  private baseDelay = 1000; // 1 second

  shouldRetry(msg: ConsumeMessage): boolean {
    const retryCount = this.getRetryCount(msg);
    return retryCount < this.maxRetries;
  }

  async retry(channel: Channel, msg: ConsumeMessage): Promise<void> {
    const retryCount = this.getRetryCount(msg);
    const delay = this.calculateDelay(retryCount);

    logger.info({ retryCount: retryCount + 1, delay }, 'Retrying message');

    await channel.sendToQueue('orders', msg.content, {
      headers: {
        ...msg.properties.headers,
        'x-retry-count': retryCount + 1,
        'x-original-timestamp': msg.properties.timestamp || Date.now(),
      },
      persistent: true,
      contentType: 'application/json',
      expiration: delay.toString(),
    });

    channel.ack(msg);
  }

  private getRetryCount(msg: ConsumeMessage): number {
    return (msg.properties.headers?.['x-retry-count'] as number) || 0;
  }

  private calculateDelay(retryCount: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s...
    return this.baseDelay * Math.pow(2, retryCount);
  }
}
