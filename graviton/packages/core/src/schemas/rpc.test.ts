import { describe, it, expect } from 'vitest';
import { JsonOrderSchema } from './rpc.js';

const VALID_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const VALID_HEX = '0xdeadbeef';

describe('JsonOrderSchema', () => {
  const validJsonOrder = {
    sender: VALID_ADDRESS,
    openDeadline: 1700000000,
    fillDeadline: 1700000600,
    initData: VALID_HEX,
    targetIntent: {
      nonce: '0',
      chainId: '42161',
      token: VALID_ADDRESS,
      amount: '2000',
      validations: [],
      executions: [],
    },
    srcIntent: {
      chainId: '1',
      nonce: '0',
      paymentTokens: [],
      preHooks: [],
      postHooks: [],
      token: VALID_ADDRESS,
      amount: '1000',
      adapter: VALID_ADDRESS,
      adapterData: VALID_HEX,
    },
    signature: VALID_HEX,
  };

  it('parses JSON order with string bigint fields', () => {
    const result = JsonOrderSchema.parse(validJsonOrder);
    expect(result.targetIntent.chainId).toBe(42161n);
    expect(result.targetIntent.amount).toBe(2000n);
    expect(result.srcIntent.chainId).toBe(1n);
    expect(result.srcIntent.amount).toBe(1000n);
    expect(result.srcIntent.nonce).toBe(0n);
  });

  it('parses JSON order with number bigint fields', () => {
    const order = {
      ...validJsonOrder,
      targetIntent: {
        ...validJsonOrder.targetIntent,
        nonce: 0,
        chainId: 42161,
        amount: 2000,
      },
      srcIntent: {
        ...validJsonOrder.srcIntent,
        chainId: 1,
        nonce: 0,
        amount: 1000,
      },
    };
    const result = JsonOrderSchema.parse(order);
    expect(result.targetIntent.chainId).toBe(42161n);
    expect(result.srcIntent.amount).toBe(1000n);
  });

  it('parses JSON order with bigint fields', () => {
    const order = {
      ...validJsonOrder,
      targetIntent: {
        ...validJsonOrder.targetIntent,
        nonce: 0n,
        chainId: 42161n,
        amount: 2000n,
      },
    };
    const result = JsonOrderSchema.parse(order);
    expect(result.targetIntent.chainId).toBe(42161n);
  });

  it('parses JSON order with payment tokens using string amounts', () => {
    const order = {
      ...validJsonOrder,
      srcIntent: {
        ...validJsonOrder.srcIntent,
        paymentTokens: [
          {
            recipient: VALID_ADDRESS,
            token: VALID_ADDRESS,
            amount: '5000',
          },
        ],
      },
    };
    const result = JsonOrderSchema.parse(order);
    expect(result.srcIntent.paymentTokens![0]!.amount).toBe(5000n);
  });

  it('parses JSON order with hooks using string values', () => {
    const order = {
      ...validJsonOrder,
      srcIntent: {
        ...validJsonOrder.srcIntent,
        preHooks: [{ to: VALID_ADDRESS, value: '0', data: VALID_HEX }],
        postHooks: [{ to: VALID_ADDRESS, value: '100', data: VALID_HEX }],
      },
    };
    const result = JsonOrderSchema.parse(order);
    expect(result.srcIntent.preHooks![0]!.value).toBe(0n);
    expect(result.srcIntent.postHooks![0]!.value).toBe(100n);
  });

  it('rejects invalid sender address', () => {
    expect(() =>
      JsonOrderSchema.parse({ ...validJsonOrder, sender: 'bad' })
    ).toThrow();
  });

  it('rejects invalid hex fields', () => {
    expect(() =>
      JsonOrderSchema.parse({ ...validJsonOrder, initData: 'not-hex' })
    ).toThrow();
  });

  it('rejects empty object', () => {
    expect(() => JsonOrderSchema.parse({})).toThrow();
  });
});
