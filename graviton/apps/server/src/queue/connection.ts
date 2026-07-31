import * as amqp from 'amqplib';
import { createLogger } from '@graviton/core';
import { config } from '../config/index.js';

const logger = createLogger('queue', config.log.level);

class QueueConnection {
  private connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  private channel: amqp.Channel | null = null;
  private isConnecting = false;

  async connect(): Promise<void> {
    if (this.connection && this.channel) {
      return;
    }

    if (this.isConnecting) {
      // Wait for connection to complete
      while (this.isConnecting) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return;
    }

    this.isConnecting = true;

    try {
      logger.info('Connecting to RabbitMQ...');
      const connection = await amqp.connect(config.rabbitmq.url);
      this.connection = connection;
      this.channel = await connection.createChannel();

      // Setup queues
      await this.setupQueues();

      // Handle connection errors
      connection.on('error', (err) => {
        logger.error({ err }, 'RabbitMQ connection error');
      });

      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        this.connection = null;
        this.channel = null;
      });

      logger.info('Connected to RabbitMQ successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to RabbitMQ');
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private async setupQueues(): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    // Assert dead letter exchange
    await this.channel.assertExchange('dlx', 'direct', { durable: true });

    // Assert orders queue with DLQ
    await this.channel.assertQueue('orders', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'dlx',
        'x-dead-letter-routing-key': 'orders.dlq',
      },
    });

    // Assert dead letter queue
    await this.channel.assertQueue('orders.dlq', { durable: true });
    await this.channel.bindQueue('orders.dlq', 'dlx', 'orders.dlq');

    logger.info('Queues setup complete');
  }

  getChannel(): amqp.Channel {
    if (!this.channel) {
      throw new Error('Queue not connected. Call connect() first.');
    }
    return this.channel;
  }

  async close(): Promise<void> {
    logger.info('Closing RabbitMQ connection');
    await this.channel?.close();
    await this.connection?.close();
    this.channel = null;
    this.connection = null;
  }
}

export const queueConnection = new QueueConnection();
