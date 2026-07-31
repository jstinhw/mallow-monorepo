import type { FastifyInstance } from 'fastify';
import { gasEstimateRoutes } from './routes/v1/gas-estimate.js';
import { healthRoutes } from './routes/v1/health.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(
    async (v1App) => {
      await v1App.register(healthRoutes);
      await v1App.register(gasEstimateRoutes);
    },
    { prefix: '/v1' }
  );
}
