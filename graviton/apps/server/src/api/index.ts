import type { FastifyInstance } from 'fastify';
import { ordersRoutes } from './routes/v1/orders.js';
import { healthRoutes } from './routes/v1/health.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(
    async (v1App) => {
      await v1App.register(healthRoutes);
      await v1App.register(ordersRoutes);
    },
    { prefix: '/v1' }
  );
}
