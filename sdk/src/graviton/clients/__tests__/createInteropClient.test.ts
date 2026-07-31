import type { KernelSmartAccountImplementation } from '@zerodev/sdk';
import { type Address, encodeFunctionData, type Hex } from 'viem';
import type { SmartAccount } from 'viem/account-abstraction';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { account7579Abi } from '../../abis/Account7579Abi.js';
import { createInteropClient } from '../createInteropClient.js';
import type { InteropClient } from '../types.js';

// Mock kernel account for testing
const createMockKernelAccount = (): SmartAccount<KernelSmartAccountImplementation> => {
  // Create properly encoded execute function data for account7579
  const mockEncodedCalls = encodeFunctionData({
    abi: account7579Abi,
    functionName: 'execute',
    args: [
      '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex, // execMode
      '0x' as Hex, // execCallData
    ],
  });

  return {
    address: '0x1234567890123456789012345678901234567890' as Address,
    factoryAddress: '0x0000000000000000000000000000000000000000' as Address,
    type: 'smart',
    source: 'kernel',
    kernelVersion: '0.3.3' as any,
    entryPoint: {
      address: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
      version: '0.7',
    },
    generateInitCode: vi.fn().mockResolvedValue('0x' as Hex),
    encodeCalls: vi.fn().mockResolvedValue(mockEncodedCalls),
    kernelPluginManager: {
      signMessage: vi.fn().mockResolvedValue('0x' as Hex),
    },
  } as any;
};

describe('createInteropClient', () => {
  let mockAccount: SmartAccount<KernelSmartAccountImplementation>;

  beforeEach(() => {
    mockAccount = createMockKernelAccount();
  });

  it('should create an InteropClient with all required properties', () => {
    const client = createInteropClient({
      account: mockAccount,
      version: 'v0.4',
    });

    expect(client).toBeDefined();
    expect(client.gravitonClient).toBeDefined();
    expect(client.version).toBe('v0.4');
  });

  describe('InteropClient actions', () => {
    let client: InteropClient;

    beforeEach(() => {
      client = createInteropClient({
        account: mockAccount,
        version: 'v0.4',
      });
    });

    it('should have prepareOrders action', () => {
      expect(client.prepareOrders).toBeDefined();
      expect(typeof client.prepareOrders).toBe('function');
    });

    it('should have sendOrders action', () => {
      expect(client.sendOrders).toBeDefined();
      expect(typeof client.sendOrders).toBe('function');
    });

    it('should have waitForOrderOpenReceipt action', () => {
      expect(client.waitForOrderOpenReceipt).toBeDefined();
      expect(typeof client.waitForOrderOpenReceipt).toBe('function');
    });

    it('should have waitForOrderFillReceipt action', () => {
      expect(client.waitForOrderFillReceipt).toBeDefined();
      expect(typeof client.waitForOrderFillReceipt).toBeDefined();
    });

    it('should be able to call prepareOrders with correct parameter types', async () => {
      // Mock the gravitonClient.request method
      const mockRequest = vi.fn().mockResolvedValue({
        orders: [],
      });
      client.gravitonClient.request = mockRequest as any;

      const params = {
        targetChainId: 8453,
        targetTokens: [
          {
            address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
            amount: BigInt(1000000),
          },
        ],
        calls: [
          {
            to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
            value: BigInt(0),
            data: '0x' as Hex,
          },
        ],
        srcTokens: [
          {
            chainId: 42161,
            address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
          },
        ],
      };

      await client.prepareOrders(params);

      expect(mockRequest).toHaveBeenCalledWith({
        method: 'gv_prepareOrders',
        params: expect.any(Object),
      });
    });

    it('should be able to call sendOrders with correct parameter types', async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        targetChainId: '8453',
        orderHashes: [],
      });
      client.gravitonClient.request = mockRequest as any;

      const params = {
        orders: [
          {
            sender: '0x1234567890123456789012345678901234567890' as Address,
            openDeadline: Math.floor(Date.now() / 1000) + 3600,
            fillDeadline: Math.floor(Date.now() / 1000) + 7200,
            initData: '0x' as Hex,
            targetIntent: {
              nonce: BigInt(1),
              chainId: BigInt(8453),
              token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
              amount: BigInt(1000000),
              validations: [],
              executions: [
                {
                  data: '0x' as Hex,
                  mode: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
                },
              ],
            },
            srcIntent: {
              chainId: BigInt(42161),
              nonce: BigInt(1),
              paymentTokens: [],
              preHooks: [],
              postHooks: [],
              token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
              amount: BigInt(1000000),
              adapter: '0x0000000000000000000000000000000000000000' as Address,
              adapterData: '0x' as Hex,
            },
            signature: '0x' as Hex,
          },
        ],
      };

      await client.sendOrders(params);

      expect(mockRequest).toHaveBeenCalled();
    });

    it('should be able to call waitForOrderOpenReceipt with correct parameter types', async () => {
      // Shape must match what the action destructures off the RPC result --
      // a mismatch is swallowed by its "continue polling" catch and shows up
      // as a test timeout rather than an error.
      const mockRequest = vi.fn().mockResolvedValue({
        event: {
          orderHash: '0x1234' as Hex,
          sender: '0x3333333333333333333333333333333333333333' as Address,
          targetChainId: '8453',
        },
        transaction: {
          hash: '0x5678' as Hex,
          blockNumber: '100',
          blockHash: '0xabcd' as Hex,
          from: '0x1111111111111111111111111111111111111111' as Address,
          to: '0x2222222222222222222222222222222222222222' as Address,
          status: 'success',
          gasUsed: '21000',
        },
      });
      client.gravitonClient.request = mockRequest as any;

      const params = {
        orderHash: '0x1234567890123456789012345678901234567890123456789012345678901234' as Hex,
        chainId: 42161,
        interopExecutor: '0xB197446a6C7223744fa1A64fdB1af840Dc1DBf62' as Address,
      };

      await client.waitForOrderOpenReceipt(params);

      expect(mockRequest).toHaveBeenCalled();
    });

    it('should be able to call waitForOrderFillReceipt with correct parameter types', async () => {
      const mockRequest = vi.fn().mockResolvedValue({
        event: {
          orderHash: '0x1234' as Hex,
          sender: '0x3333333333333333333333333333333333333333' as Address,
          srcChainId: '42161',
        },
        transaction: {
          hash: '0x9abc' as Hex,
          blockNumber: '200',
          blockHash: '0xabcd' as Hex,
          from: '0x1111111111111111111111111111111111111111' as Address,
          to: '0x2222222222222222222222222222222222222222' as Address,
          status: 'success',
          gasUsed: '21000',
        },
      });
      client.gravitonClient.request = mockRequest as any;

      const params = {
        orderHash: '0x1234567890123456789012345678901234567890123456789012345678901234' as Hex,
        chainId: 8453,
        interopExecutor: '0xB197446a6C7223744fa1A64fdB1af840Dc1DBf62' as Address,
      };

      await client.waitForOrderFillReceipt(params);

      expect(mockRequest).toHaveBeenCalled();
    });
  });

  describe('Type inference', () => {
    it('should properly infer types for InteropClient', () => {
      const client = createInteropClient({
        account: mockAccount,
        version: 'v0.4',
      });

      // TypeScript should infer these types correctly
      const _account: typeof client.account = client.account;
      const _version: typeof client.version = client.version;
      const _gravitonClient: typeof client.gravitonClient = client.gravitonClient;

      // Actions should be properly typed
      const _prepareOrders: typeof client.prepareOrders = client.prepareOrders;
      const _sendOrders: typeof client.sendOrders = client.sendOrders;
      const _waitForOrderOpenReceipt: typeof client.waitForOrderOpenReceipt =
        client.waitForOrderOpenReceipt;
      const _waitForOrderFillReceipt: typeof client.waitForOrderFillReceipt =
        client.waitForOrderFillReceipt;

      // Verify types exist (prevents unused variable warnings)
      expect(_account).toBeDefined();
      expect(_version).toBeDefined();
      expect(_gravitonClient).toBeDefined();
      expect(_prepareOrders).toBeDefined();
      expect(_sendOrders).toBeDefined();
      expect(_waitForOrderOpenReceipt).toBeDefined();
      expect(_waitForOrderFillReceipt).toBeDefined();
    });
  });
});
