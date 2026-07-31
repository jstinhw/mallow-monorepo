import type { FastifyInstance } from 'fastify';
import {
  serializeBigInt,
  swapRouteRequestSchema,
  multiInputQuoteRequestSchema,
  type QuoteRequest,
  type MultiInputQuoteRequest,
  type SwapRouteRequest,
  quoteRequestSchema,
} from '@graviton/core';
import { QuoteService } from '../../services/quote/quote.service.js';

export async function quoteRoutes(app: FastifyInstance) {
  const quoteService = new QuoteService();

  app.post<{
    Body: QuoteRequest;
  }>('/quote', async (request, reply) => {
    try {
      // Validate request body
      const validated = quoteRequestSchema.safeParse(request.body);

      if (!validated.success) {
        return reply.code(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: validated.error,
        });
      }
      const params = validated.data;

      const quote = await quoteService.getQuote(params);
      return reply.send(serializeBigInt(quote));
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return reply.code(400).send({
          error: 'Invalid request parameters',
          details: error,
        });
      }

      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /v1/quote/multi-input
   * Get a quote for multiple input tokens to multiple output tokens
   */
  app.post<{
    Body: MultiInputQuoteRequest;
  }>('/quote/multi-input', async (request, reply) => {
    try {
      // Validate request body
      const validated = multiInputQuoteRequestSchema.safeParse(request.body);

      if (!validated.success) {
        return reply.code(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: validated.error,
        });
      }
      const params = validated.data;

      const quote = await quoteService.getMultiInputQuote(params);
      return reply.send(serializeBigInt(quote));
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return reply.code(400).send({
          error: 'Invalid request parameters',
          details: error,
        });
      }

      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /v1/quote/route
   * Get swap route quotes for multiple input tokens to multiple output tokens
   * Returns a quote for each input token -> all output tokens combination
   */
  app.post<{
    Body: SwapRouteRequest;
  }>('/quote/route', async (request, reply) => {
    try {
      // Validate request body
      const validated = swapRouteRequestSchema.safeParse(request.body);

      if (!validated.success) {
        return reply.code(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid request parameters',
          details: validated.error,
        });
      }
      const params = validated.data;
      const quote = await quoteService.getSwapRoute(params);

      return reply.send(serializeBigInt(quote));
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return reply.code(400).send({
          error: 'Invalid request parameters',
          details: error,
        });
      }

      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
