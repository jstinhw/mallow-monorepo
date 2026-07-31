import { describe, it, expect } from 'vitest';
import {
  PaymentTokenSchema,
  ValidationCallSchema,
  ExecutionCallSchema,
  SrcIntentSchema,
  TargetIntentSchema,
  OrderSchema,
} from './order.js';
import { CallSchema } from './commons.js';

const VALID_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const VALID_HEX = '0xdeadbeef';

describe('PaymentTokenSchema', () => {
  it('parses valid payment token', () => {
    const result = PaymentTokenSchema.parse({
      recipient: VALID_ADDRESS,
      token: VALID_ADDRESS,
      amount: 1000n,
    });
    expect(result.amount).toBe(1000n);
    expect(result.recipient).toMatch(/^0x/);
    expect(result.token).toMatch(/^0x/);
  });

  it('rejects missing fields', () => {
    expect(() => PaymentTokenSchema.parse({})).toThrow();
    expect(() =>
      PaymentTokenSchema.parse({ recipient: VALID_ADDRESS })
    ).toThrow();
  });

  it('rejects invalid address', () => {
    expect(() =>
      PaymentTokenSchema.parse({
        recipient: 'invalid',
        token: VALID_ADDRESS,
        amount: 1000n,
      })
    ).toThrow();
  });

  it('rejects non-bigint amount', () => {
    expect(() =>
      PaymentTokenSchema.parse({
        recipient: VALID_ADDRESS,
        token: VALID_ADDRESS,
        amount: 'not-bigint',
      })
    ).toThrow();
  });
});

describe('ValidationCallSchema', () => {
  it('parses valid validation call', () => {
    const result = ValidationCallSchema.parse({
      validator: VALID_ADDRESS,
      data: VALID_HEX,
    });
    expect(result.validator).toMatch(/^0x/);
    expect(result.data).toBe(VALID_HEX);
  });

  it('rejects missing data', () => {
    expect(() =>
      ValidationCallSchema.parse({ validator: VALID_ADDRESS })
    ).toThrow();
  });
});

describe('ExecutionCallSchema', () => {
  it('parses valid execution call', () => {
    const result = ExecutionCallSchema.parse({
      data: VALID_HEX,
      mode: VALID_HEX,
    });
    expect(result.data).toBe(VALID_HEX);
    expect(result.mode).toBe(VALID_HEX);
  });

  it('rejects invalid hex', () => {
    expect(() =>
      ExecutionCallSchema.parse({ data: 'bad', mode: VALID_HEX })
    ).toThrow();
  });
});

describe('CallSchema', () => {
  it('parses valid call', () => {
    const result = CallSchema.parse({
      to: VALID_ADDRESS,
      value: 0n,
      data: VALID_HEX,
    });
    expect(result.to).toMatch(/^0x/);
    expect(result.value).toBe(0n);
  });

  it('rejects missing to address', () => {
    expect(() => CallSchema.parse({ value: 0n, data: VALID_HEX })).toThrow();
  });
});

describe('SrcIntentSchema', () => {
  const validSrcIntent = {
    chainId: 1n,
    nonce: 0n,
    paymentTokens: [],
    preHooks: [],
    postHooks: [],
    token: VALID_ADDRESS,
    amount: 1000n,
    adapter: VALID_ADDRESS,
    adapterData: VALID_HEX,
  };

  it('parses valid src intent', () => {
    const result = SrcIntentSchema.parse(validSrcIntent);
    expect(result.chainId).toBe(1n);
    expect(result.amount).toBe(1000n);
    expect(result.paymentTokens).toEqual([]);
  });

  it('parses with payment tokens', () => {
    const result = SrcIntentSchema.parse({
      ...validSrcIntent,
      paymentTokens: [
        {
          recipient: VALID_ADDRESS,
          token: VALID_ADDRESS,
          amount: 500n,
        },
      ],
    });
    expect(result.paymentTokens).toHaveLength(1);
    expect(result.paymentTokens[0]!.amount).toBe(500n);
  });

  it('parses with hooks', () => {
    const hook = { to: VALID_ADDRESS, value: 0n, data: VALID_HEX };
    const result = SrcIntentSchema.parse({
      ...validSrcIntent,
      preHooks: [hook],
      postHooks: [hook],
    });
    expect(result.preHooks).toHaveLength(1);
    expect(result.postHooks).toHaveLength(1);
  });

  it('rejects missing required fields', () => {
    expect(() => SrcIntentSchema.parse({})).toThrow();
    expect(() => SrcIntentSchema.parse({ chainId: 1n, nonce: 0n })).toThrow();
  });
});

describe('TargetIntentSchema', () => {
  const validTargetIntent = {
    nonce: 0n,
    chainId: 42161n,
    token: VALID_ADDRESS,
    amount: 2000n,
    validations: [],
    executions: [],
  };

  it('parses valid target intent', () => {
    const result = TargetIntentSchema.parse(validTargetIntent);
    expect(result.chainId).toBe(42161n);
    expect(result.amount).toBe(2000n);
  });

  it('parses with validations and executions', () => {
    const result = TargetIntentSchema.parse({
      ...validTargetIntent,
      validations: [{ validator: VALID_ADDRESS, data: VALID_HEX }],
      executions: [{ data: VALID_HEX, mode: VALID_HEX }],
    });
    expect(result.validations).toHaveLength(1);
    expect(result.executions).toHaveLength(1);
  });

  it('rejects missing required fields', () => {
    expect(() => TargetIntentSchema.parse({})).toThrow();
  });
});

describe('OrderSchema', () => {
  const validOrder = {
    sender: VALID_ADDRESS,
    openDeadline: 1700000000,
    fillDeadline: 1700000600,
    initData: VALID_HEX,
    targetIntent: {
      nonce: 0n,
      chainId: 42161n,
      token: VALID_ADDRESS,
      amount: 2000n,
      validations: [],
      executions: [],
    },
    srcIntent: {
      chainId: 1n,
      nonce: 0n,
      paymentTokens: [],
      preHooks: [],
      postHooks: [],
      token: VALID_ADDRESS,
      amount: 1000n,
      adapter: VALID_ADDRESS,
      adapterData: VALID_HEX,
    },
    signature: VALID_HEX,
  };

  it('parses a valid order', () => {
    const result = OrderSchema.parse(validOrder);
    expect(result.sender).toMatch(/^0x/);
    expect(result.openDeadline).toBe(1700000000);
    expect(result.fillDeadline).toBe(1700000600);
    expect(result.targetIntent.chainId).toBe(42161n);
    expect(result.srcIntent.chainId).toBe(1n);
  });

  it('rejects negative deadlines', () => {
    expect(() =>
      OrderSchema.parse({ ...validOrder, openDeadline: -1 })
    ).toThrow();
    expect(() =>
      OrderSchema.parse({ ...validOrder, fillDeadline: -100 })
    ).toThrow();
  });

  it('rejects non-integer deadlines', () => {
    expect(() =>
      OrderSchema.parse({ ...validOrder, openDeadline: 1.5 })
    ).toThrow();
  });

  it('rejects invalid sender address', () => {
    expect(() => OrderSchema.parse({ ...validOrder, sender: 'bad' })).toThrow();
  });

  it('rejects invalid signature', () => {
    expect(() =>
      OrderSchema.parse({ ...validOrder, signature: 'not-hex' })
    ).toThrow();
  });

  it('rejects empty object', () => {
    expect(() => OrderSchema.parse({})).toThrow();
  });
});
