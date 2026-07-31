import { describe, it, expect } from 'vitest';
import { serializeBigInt } from './serialization.utils.js';

describe('serializeBigInt', () => {
  it('returns null as-is', () => {
    expect(serializeBigInt(null)).toBeNull();
  });

  it('returns undefined as-is', () => {
    expect(serializeBigInt(undefined)).toBeUndefined();
  });

  it('converts bigint to string', () => {
    expect(serializeBigInt(42n)).toBe('42');
    expect(serializeBigInt(0n)).toBe('0');
    expect(serializeBigInt(1000000000000000000n)).toBe('1000000000000000000');
  });

  it('returns numbers as-is', () => {
    expect(serializeBigInt(42)).toBe(42);
    expect(serializeBigInt(0)).toBe(0);
  });

  it('returns strings as-is', () => {
    expect(serializeBigInt('hello')).toBe('hello');
    expect(serializeBigInt('')).toBe('');
  });

  it('returns booleans as-is', () => {
    expect(serializeBigInt(true)).toBe(true);
    expect(serializeBigInt(false)).toBe(false);
  });

  it('recursively serializes arrays', () => {
    const input = [1n, 2n, 'three'];
    const result = serializeBigInt(input);
    expect(result).toEqual(['1', '2', 'three']);
  });

  it('handles nested arrays', () => {
    const input = [[1n], [2n, 3n]];
    const result = serializeBigInt(input);
    expect(result).toEqual([['1'], ['2', '3']]);
  });

  it('recursively serializes objects', () => {
    const input = { a: 1n, b: 'hello', c: 2n };
    const result = serializeBigInt(input);
    expect(result).toEqual({ a: '1', b: 'hello', c: '2' });
  });

  it('handles deeply nested objects', () => {
    const input = {
      level1: {
        level2: {
          value: 100n,
          name: 'test',
        },
      },
    };
    const result = serializeBigInt(input);
    expect(result).toEqual({
      level1: {
        level2: {
          value: '100',
          name: 'test',
        },
      },
    });
  });

  it('handles mixed objects and arrays', () => {
    const input = {
      amounts: [1000n, 2000n],
      nested: { amount: 500n },
      label: 'payment',
    };
    const result = serializeBigInt(input);
    expect(result).toEqual({
      amounts: ['1000', '2000'],
      nested: { amount: '500' },
      label: 'payment',
    });
  });

  it('handles empty structures', () => {
    expect(serializeBigInt([])).toEqual([]);
    expect(serializeBigInt({})).toEqual({});
  });

  it('result is JSON-serializable', () => {
    const input = { value: 42n, list: [1n, 2n] };
    const serialized = serializeBigInt(input);
    const json = JSON.stringify(serialized);
    expect(json).toBe('{"value":"42","list":["1","2"]}');
  });
});
