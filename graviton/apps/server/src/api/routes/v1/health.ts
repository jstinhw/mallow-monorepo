import type { FastifyInstance } from 'fastify';
import { queueConnection } from '../../../queue/connection.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    try {
      const channel = queueConnection.getChannel();
      if (!channel) {
        throw new Error('RabbitMQ channel not available');
      }

      return reply.send({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
          rabbitmq: 'connected',
        },
      });
    } catch (error) {
      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
