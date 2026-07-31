import { describe, it, expect } from 'vitest';
import { deepHexlify } from './deepHexlify.js';

describe('deepHexlify', () => {
  it('returns null/undefined as-is', () => {
    expect(deepHexlify(null)).toBeNull();
    expect(deepHexlify(undefined)).toBeUndefined();
  });

  it('returns strings as-is', () => {
    expect(deepHexlify('hello')).toBe('hello');
    expect(deepHexlify('0xabc')).toBe('0xabc');
    expect(deepHexlify('')).toBe('');
  });

  it('returns booleans as-is', () => {
    expect(deepHexlify(true)).toBe(true);
    expect(deepHexlify(false)).toBe(false);
  });

  it('returns numbers as-is (does not hexlify)', () => {
    expect(deepHexlify(42)).toBe(42);
    expect(deepHexlify(0)).toBe(0);
    expect(deepHexlify(-1)).toBe(-1);
  });

  it('converts bigints to hex strings', () => {
    expect(deepHexlify(0n)).toBe('0x0');
    expect(deepHexlify(255n)).toBe('0xff');
    expect(deepHexlify(1000000n)).toBe('0xf4240');
  });

  it('returns undefined for functions', () => {
    expect(deepHexlify(() => {})).toBeUndefined();
    expect(deepHexlify(function test() {})).toBeUndefined();
  });

  it('recursively processes arrays', () => {
    const input = [1n, 'hello', 2n];
    const result = deepHexlify(input);
    expect(result).toEqual(['0x1', 'hello', '0x2']);
  });

  it('handles nested arrays', () => {
    const input = [[1n, 2n], [3n]];
    const result = deepHexlify(input);
    expect(result).toEqual([['0x1', '0x2'], ['0x3']]);
  });

  it('recursively processes objects', () => {
    const input = { a: 1n, b: 'hello', c: 2n };
    const result = deepHexlify(input);
    expect(result).toEqual({ a: '0x1', b: 'hello', c: '0x2' });
  });

  it('handles deeply nested objects', () => {
    const input = {
      outer: {
        inner: {
          value: 42n,
        },
      },
    };
    const result = deepHexlify(input);
    expect(result).toEqual({
      outer: {
        inner: {
          value: '0x2a',
        },
      },
    });
  });

  it('handles mixed arrays and objects', () => {
    const input = {
      values: [1n, 2n, 3n],
      name: 'test',
      nested: { amount: 100n },
    };
    const result = deepHexlify(input);
    expect(result).toEqual({
      values: ['0x1', '0x2', '0x3'],
      name: 'test',
      nested: { amount: '0x64' },
    });
  });

  it('handles empty arrays and objects', () => {
    expect(deepHexlify([])).toEqual([]);
    expect(deepHexlify({})).toEqual({});
  });

  it('handles _isBigNumber objects', () => {
    const bn = { _isBigNumber: true, toHexString: () => '0xff' };
    const result = deepHexlify(bn);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^0x/);
  });
});
