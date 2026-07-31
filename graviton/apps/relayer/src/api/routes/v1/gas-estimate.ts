import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { serializeBigInt } from '@graviton/core';
import { gasEstimateRequestSchema } from '../../schemas/gas-estimate.schema.js';
import { gasEstimationService } from '../../../services/gas-estimation.service.js';

export async function gasEstimateRoutes(app: FastifyInstance) {
  /**
   * POST /v1/gas
   * Unified endpoint for all gas estimation operations
   *
   * Supports three operation types:
   * - "open": Estimate gas for opening an order on source chain
   * - "fill": Estimate gas for filling an order on target chain
   *
   * Example requests:
   *
   * Open operation:
   * {
   *   "operation": "open",
   *   "order": { ... },
   * }
   *
   * Fill operation:
   * {
   *   "operation": "fill",
   *   "order": { ... },
   *   "token": "0x...",
   *   "amount": "1000000",
   * }
   */
  app.post('/gas', async (request, reply) => {
    try {
      const params = gasEstimateRequestSchema.parse(request.body);

      let result;

      switch (params.operation) {
        case 'open':
          result = await gasEstimationService.estimateOpen(
            params.order,
            params.interopExecutor,
            params.stateOverrides
          );
          break;

        case 'fill':
          result = await gasEstimationService.estimateFill(
            params.order,
            params.token as `0x${string}`,
            BigInt(params.amount),
            params.stateOverrides
          );
          break;

        default:
          // TypeScript should prevent this, but handle it for runtime safety
          return reply.code(400).send({
            error: 'Invalid operation type',
          });
      }

      return reply.send(serializeBigInt(result));
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: error.errors.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      // Handle other errors
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
