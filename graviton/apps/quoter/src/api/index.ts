import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { quoteRoutes } from './routes/quote.js';

export async function registerRoutes(app: FastifyInstance) {
  // Health check route (no version prefix)
  await app.register(healthRoutes);

  // V1 API routes
  await app.register(
    async (apiV1) => {
      await apiV1.register(quoteRoutes);
    },
    { prefix: '/v1' }
  );
}
