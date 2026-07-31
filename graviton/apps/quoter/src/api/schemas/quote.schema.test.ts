import { describe, it, expect } from 'vitest';
import { bridgeQuoteSchema } from './quote.schema.js';

describe('bridgeQuoteSchema', () => {
  const validQuery = {
    sourceChainId: '42161',
    destinationChainId: '8453',
    token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    amount: '1000000',
    bridgeType: 'cctp',
  };

  describe('querystring', () => {
    it('parses valid query parameters', () => {
      const result = bridgeQuoteSchema.querystring.parse(validQuery);

      expect(result.sourceChainId).toBe(42161);
      expect(result.destinationChainId).toBe(8453);
      expect(result.token).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
      expect(result.amount).toBe('1000000');
      expect(result.bridgeType).toBe('cctp');
    });

    it('coerces string chain IDs to numbers', () => {
      const result = bridgeQuoteSchema.querystring.parse(validQuery);
      expect(typeof result.sourceChainId).toBe('number');
      expect(typeof result.destinationChainId).toBe('number');
    });

    it('accepts across bridge type', () => {
      const result = bridgeQuoteSchema.querystring.parse({
        ...validQuery,
        bridgeType: 'across',
      });
      expect(result.bridgeType).toBe('across');
    });

    it('rejects invalid bridge type', () => {
      expect(() =>
        bridgeQuoteSchema.querystring.parse({
          ...validQuery,
          bridgeType: 'unknown',
        })
      ).toThrow();
    });

    it('rejects invalid address format', () => {
      expect(() =>
        bridgeQuoteSchema.querystring.parse({
          ...validQuery,
          token: 'not-an-address',
        })
      ).toThrow();
    });

    it('rejects non-numeric amount', () => {
      expect(() =>
        bridgeQuoteSchema.querystring.parse({
          ...validQuery,
          amount: 'abc',
        })
      ).toThrow();
    });

    it('accepts optional fields', () => {
      const result = bridgeQuoteSchema.querystring.parse({
        ...validQuery,
        inputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        depositor: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
      });

      expect(result.inputToken).toBeDefined();
      expect(result.outputToken).toBeDefined();
      expect(result.depositor).toBeDefined();
      expect(result.recipient).toBeDefined();
    });

    it('works without optional fields', () => {
      const result = bridgeQuoteSchema.querystring.parse(validQuery);
      expect(result.inputToken).toBeUndefined();
      expect(result.outputToken).toBeUndefined();
      expect(result.depositor).toBeUndefined();
      expect(result.recipient).toBeUndefined();
    });
  });
});
