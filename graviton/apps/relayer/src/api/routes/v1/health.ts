import type { FastifyInstance } from 'fastify';
import { getPublicClient } from '@graviton/core';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    try {
      // Check blockchain connection
      const publicClient = getPublicClient(1);
      const blockNumber = publicClient.getBlockNumber();

      return reply.send({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          blockchain: 'connected',
          blockNumber: blockNumber.toString(),
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
