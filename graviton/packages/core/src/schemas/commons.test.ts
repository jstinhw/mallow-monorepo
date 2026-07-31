import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import { AddressSchema, HexSchema, BigIntSchema } from './commons.js';

describe('AddressSchema', () => {
  it('accepts a valid checksummed address', () => {
    const addr = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    const result = AddressSchema.parse(addr);
    expect(result).toBe(getAddress(addr));
  });

  it('accepts a lowercase address and transforms to checksum', () => {
    const lower = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const result = AddressSchema.parse(lower);
    expect(result).toBe(getAddress(lower));
    expect(result).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('accepts zero address', () => {
    const result = AddressSchema.parse(
      '0x0000000000000000000000000000000000000000'
    );
    expect(result).toBe('0x0000000000000000000000000000000000000000');
  });

  it('rejects invalid addresses', () => {
    expect(() => AddressSchema.parse('not-an-address')).toThrow();
    expect(() => AddressSchema.parse('0x123')).toThrow();
    expect(() => AddressSchema.parse('')).toThrow();
    expect(() => AddressSchema.parse('0x')).toThrow();
  });

  it('rejects non-string input', () => {
    expect(() => AddressSchema.parse(123)).toThrow();
    expect(() => AddressSchema.parse(null)).toThrow();
    expect(() => AddressSchema.parse(undefined)).toThrow();
  });
});

describe('HexSchema', () => {
  it('accepts valid hex strings', () => {
    expect(HexSchema.parse('0x')).toBe('0x');
    expect(HexSchema.parse('0x00')).toBe('0x00');
    expect(HexSchema.parse('0xdeadbeef')).toBe('0xdeadbeef');
  });

  it('accepts long hex strings', () => {
    const longHex = '0x' + 'ab'.repeat(100);
    expect(HexSchema.parse(longHex)).toBe(longHex);
  });

  it('rejects invalid hex strings', () => {
    expect(() => HexSchema.parse('deadbeef')).toThrow();
    expect(() => HexSchema.parse('0xGG')).toThrow();
    expect(() => HexSchema.parse('')).toThrow();
    expect(() => HexSchema.parse('hello')).toThrow();
  });

  it('rejects non-string input', () => {
    expect(() => HexSchema.parse(123)).toThrow();
    expect(() => HexSchema.parse(null)).toThrow();
  });
});

describe('BigIntSchema', () => {
  it('transforms string to bigint', () => {
    expect(BigIntSchema.parse('12345')).toBe(12345n);
    expect(BigIntSchema.parse('0')).toBe(0n);
  });

  it('transforms number to bigint', () => {
    expect(BigIntSchema.parse(42)).toBe(42n);
    expect(BigIntSchema.parse(0)).toBe(0n);
  });

  it('passes through bigint values', () => {
    expect(BigIntSchema.parse(999n)).toBe(999n);
    expect(BigIntSchema.parse(0n)).toBe(0n);
  });

  it('handles large numeric strings', () => {
    const large = '999999999999999999999999999999';
    expect(BigIntSchema.parse(large)).toBe(BigInt(large));
  });

  it('rejects non-numeric strings', () => {
    expect(() => BigIntSchema.parse('not-a-number')).toThrow();
  });

  it('rejects objects and arrays', () => {
    expect(() => BigIntSchema.parse({})).toThrow();
    expect(() => BigIntSchema.parse([])).toThrow();
  });
});
