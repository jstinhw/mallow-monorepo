import { queueConnection } from './connection.js';
import type { Order } from '@graviton/core';
import { createLogger, serializeBigInt } from '@graviton/core';
import { config } from '../config/index.js';

const logger = createLogger('publisher', config.log.level);

export class QueuePublisher {
  async publishOrder({ orders }: { orders: Order[] }): Promise<void> {
    const channel = queueConnection.getChannel();

    if (orders.length === 0) {
      throw new Error('No orders to publish');
    }
    const sender = orders[0]?.sender;

    const message = JSON.stringify({ orders: serializeBigInt(orders) });

    channel.sendToQueue('orders', Buffer.from(message), {
      persistent: true,
      contentType: 'application/json',
      timestamp: Date.now(),
    });

    logger.info({ sender: sender }, 'Order published to queue');
  }
}

export const queuePublisher = new QueuePublisher();
