// import amqp, { Connection, Channel, ConsumeMessage } from 'amqplib';
import * as amqp from 'amqplib';
import { createLogger, orderBatchMessageSchema } from '@graviton/core';
import { config } from '../config/index.js';
import { OrderProcessor } from './processor.js';
import { RetryHandler } from './retry-handler.js';

const logger = createLogger('worker', config.log.level);

export class WorkerConsumer {
  private connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: amqp.Channel | null = null;
  private processor: OrderProcessor;
  private retryHandler: RetryHandler;
  private isShuttingDown = false;

  constructor() {
    this.processor = new OrderProcessor();
    this.retryHandler = new RetryHandler();
  }

  async start(): Promise<void> {
    logger.info('Starting worker...');

    // Connect to RabbitMQ
    this.connection = await amqp.connect(config.rabbitmq.url);
    this.channel = await this.connection.createChannel();

    // Set prefetch to control concurrency
    await this.channel.prefetch(config.worker.concurrency);

    // Assert queue
    await this.channel.assertQueue('orders', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'dlx',
        'x-dead-letter-routing-key': 'orders.dlq',
      },
    });

    logger.info(
      { concurrency: config.worker.concurrency },
      'Worker started, consuming messages'
    );

    // Start consuming
    await this.channel.consume('orders', this.handleMessage.bind(this), {
      noAck: false,
    });

    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  private async handleMessage(msg: amqp.ConsumeMessage | null): Promise<void> {
    if (!msg || this.isShuttingDown) return;

    try {
      const messageData = JSON.parse(msg.content.toString());

      // Parse and validate message schema
      const { orders } = orderBatchMessageSchema.parse(messageData);

      logger.info({ orderCount: orders.length }, 'Received order batch');

      // Process orders
      await this.processor.processOrders(orders);

      // Acknowledge successful processing
      this.channel?.ack(msg);

      logger.info(
        { orderCount: orders.length },
        'Order batch processed successfully'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to process message');

      // Check if should retry
      if (this.retryHandler.shouldRetry(msg)) {
        await this.retryHandler.retry(this.channel!, msg);
      } else {
        // Send to DLQ
        logger.warn('Max retries reached, sending to DLQ');
        this.channel?.reject(msg, false);
      }
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return;

      this.isShuttingDown = true;
      logger.info('Shutting down worker...');

      // Stop accepting new messages
      if (this.channel) {
        try {
          await this.channel.cancel('worker');
        } catch (error) {
          logger.warn({ error }, 'Error cancelling consumer');
        }
      }

      // Wait for in-flight messages
      logger.info('Waiting for in-flight messages to complete...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Close connections
      try {
        await this.channel?.close();
        await this.connection?.close();
      } catch (error) {
        logger.warn({ error }, 'Error closing connections');
      }

      logger.info('Worker shut down complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}
