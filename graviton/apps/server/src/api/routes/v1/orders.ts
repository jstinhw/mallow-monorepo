import type { FastifyInstance } from 'fastify';
import { OrderService } from '../../../services/order.service.js';
import { ValidationError, serializeBigInt } from '@graviton/core';
import { prepareOrderRequestSchema } from '../../schemas/prepare-order.schema.js';
import { submitOrderRequestSchema } from '../../schemas/submit-order.schema.js';
import {
  RelayerServiceError,
  GasEstimationError,
  InsufficientOutputError,
  QuoterServiceError,
} from '../../../errors/index.js';

// JSON-RPC 2.0 types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: string | number | null;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: JsonRpcError;
  id: string | number | null;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// JSON-RPC error codes
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom application errors
  VALIDATION_ERROR: -32001,
  INSUFFICIENT_BALANCE: -32002,
  BATCH_VALIDATION_FAILED: -32003,
  NOT_FOUND: -32004,
  SERVICE_ERROR: -32005,
  GAS_ESTIMATION_ERROR: -32006,
};

export async function ordersRoutes(app: FastifyInstance) {
  const orderService = new OrderService();

  // JSON-RPC endpoint
  app.post('/', async (request, reply) => {
    let rpcRequest: JsonRpcRequest;

    // Parse request
    try {
      rpcRequest = request.body as JsonRpcRequest;

      // Validate JSON-RPC request structure
      if (!rpcRequest || rpcRequest.jsonrpc !== '2.0' || !rpcRequest.method) {
        return reply.code(200).send({
          jsonrpc: '2.0',
          error: {
            code: JSON_RPC_ERRORS.INVALID_REQUEST,
            message: 'Invalid JSON-RPC request',
          },
          id: null,
        } as JsonRpcResponse);
      }
    } catch {
      return reply.code(200).send({
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERRORS.PARSE_ERROR,
          message: 'Parse error',
        },
        id: null,
      } as JsonRpcResponse);
    }

    const { method, params, id } = rpcRequest;

    try {
      let result: unknown;

      switch (method) {
        case 'gv_prepareOrders': {
          try {
            const validatedParams = prepareOrderRequestSchema.parse(params);
            result = await orderService.prepareOrder(validatedParams);
            result = serializeBigInt(result);
          } catch (error) {
            if (error instanceof ValidationError) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.VALIDATION_ERROR,
                  message: 'Validation failed',
                  data: error.errors,
                },
                id,
              } as JsonRpcResponse);
            }
            if (error instanceof RelayerServiceError) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.SERVICE_ERROR,
                  message: error.message,
                  data: error.details,
                },
                id,
              } as JsonRpcResponse);
            }
            if (error instanceof GasEstimationError) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.GAS_ESTIMATION_ERROR,
                  message: error.message,
                  data: { chainId: error.chainId },
                },
                id,
              } as JsonRpcResponse);
            }
            if (error instanceof QuoterServiceError) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.SERVICE_ERROR,
                  message: error.message,
                  data: {
                    statusCode: error.statusCode,
                    responseBody: error.responseBody,
                  },
                },
                id,
              } as JsonRpcResponse);
            }
            if (error instanceof InsufficientOutputError) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.INSUFFICIENT_BALANCE,
                  message: error.message,
                  data: {
                    accumulatedOutput: Object.fromEntries(
                      Array.from(error.accumulatedOutput.entries()).map(
                        ([addr, amt]) => [addr, amt.toString()]
                      )
                    ),
                    targetAmounts: Object.fromEntries(
                      Array.from(error.targetAmounts.entries()).map(
                        ([addr, amt]) => [addr, amt.toString()]
                      )
                    ),
                  },
                },
                id,
              } as JsonRpcResponse);
            }
            if (
              error instanceof Error &&
              error.message.includes('Insufficient balance')
            ) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.INSUFFICIENT_BALANCE,
                  message: error.message,
                },
                id,
              } as JsonRpcResponse);
            }
            throw error;
          }
          break;
        }

        case 'gv_sendOrders': {
          try {
            const validatedParams = submitOrderRequestSchema.parse(params);
            result = await orderService.submitSignedOrders(
              validatedParams.orders
            );
          } catch (error) {
            if (error instanceof ValidationError) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.VALIDATION_ERROR,
                  message: 'Validation failed',
                  data: error.errors,
                },
                id,
              } as JsonRpcResponse);
            }
            if (
              error instanceof Error &&
              error.message.includes('Batch validation failed')
            ) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.BATCH_VALIDATION_FAILED,
                  message: error.message,
                },
                id,
              } as JsonRpcResponse);
            }
            throw error;
          }
          break;
        }

        case 'gv_getOrderOpenReceipt': {
          const { orderHash, chainId, interopExecutor } = params as {
            orderHash: string;
            chainId: number;
            interopExecutor?: string;
          };

          if (!orderHash || !chainId) {
            return reply.code(200).send({
              jsonrpc: '2.0',
              error: {
                code: JSON_RPC_ERRORS.INVALID_PARAMS,
                message: 'Missing required parameters: orderHash and chainId',
              },
              id,
            } as JsonRpcResponse);
          }

          try {
            const receipt = await orderService.getOrderOpenReceipt(
              orderHash as `0x${string}`,
              BigInt(chainId),
              interopExecutor as `0x${string}` | undefined
            );

            if (!receipt) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.NOT_FOUND,
                  message:
                    'OrderOpened event not found for the given orderHash',
                },
                id,
              } as JsonRpcResponse);
            }

            result = serializeBigInt(receipt);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes('Unsupported chain ID')
            ) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.INVALID_PARAMS,
                  message: error.message,
                },
                id,
              } as JsonRpcResponse);
            }
            throw error;
          }
          break;
        }

        case 'gv_getOrderFillReceipt': {
          const { orderHash, chainId, interopExecutor } = params as {
            orderHash: string;
            chainId: number;
            interopExecutor?: string;
          };

          if (!orderHash || !chainId) {
            return reply.code(200).send({
              jsonrpc: '2.0',
              error: {
                code: JSON_RPC_ERRORS.INVALID_PARAMS,
                message: 'Missing required parameters: orderHash and chainId',
              },
              id,
            } as JsonRpcResponse);
          }

          try {
            const receipt = await orderService.getOrderFillReceipt(
              orderHash as `0x${string}`,
              BigInt(chainId),
              interopExecutor as `0x${string}` | undefined
            );

            if (!receipt) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.NOT_FOUND,
                  message:
                    'OrderFilled event not found for the given orderHash',
                },
                id,
              } as JsonRpcResponse);
            }

            result = serializeBigInt(receipt);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes('Unsupported chain ID')
            ) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                error: {
                  code: JSON_RPC_ERRORS.INVALID_PARAMS,
                  message: error.message,
                },
                id,
              } as JsonRpcResponse);
            }
            throw error;
          }
          break;
        }

        default:
          return reply.code(200).send({
            jsonrpc: '2.0',
            error: {
              code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
              message: `Method '${method}' not found`,
            },
            id,
          } as JsonRpcResponse);
      }

      // Success response
      return reply.code(200).send({
        jsonrpc: '2.0',
        result,
        id,
      } as JsonRpcResponse);
    } catch (error) {
      // Internal error
      return reply.code(200).send({
        jsonrpc: '2.0',
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : 'Internal error',
        },
        id,
      } as JsonRpcResponse);
    }
  });
}
