import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate, validateSafe, ValidationError } from './validation.js';

const testSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
});

describe('ValidationError', () => {
  it('has correct name and message', () => {
    const error = new ValidationError('test error', [
      { path: 'field', message: 'invalid' },
    ]);
    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('test error');
    expect(error).toBeInstanceOf(Error);
  });

  it('stores error details', () => {
    const errors = [
      { path: 'name', message: 'Required' },
      { path: 'age', message: 'Must be positive' },
    ];
    const error = new ValidationError('Validation failed', errors);
    expect(error.errors).toEqual(errors);
    expect(error.errors).toHaveLength(2);
  });
});

describe('validate', () => {
  it('returns parsed data for valid input', () => {
    const result = validate(testSchema, { name: 'Alice', age: 30 });
    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('throws ValidationError for invalid input', () => {
    expect(() => validate(testSchema, { name: '', age: -1 })).toThrow(
      ValidationError
    );
  });

  it('thrown error contains field-level errors', () => {
    try {
      validate(testSchema, { name: '', age: -1 });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const vError = error as ValidationError;
      expect(vError.errors.length).toBeGreaterThanOrEqual(2);
      expect(vError.errors.some((e) => e.path === 'name')).toBe(true);
      expect(vError.errors.some((e) => e.path === 'age')).toBe(true);
    }
  });

  it('throws ValidationError with joined path for nested errors', () => {
    const nestedSchema = z.object({
      user: z.object({
        email: z.string().email(),
      }),
    });

    try {
      validate(nestedSchema, { user: { email: 'invalid' } });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const vError = error as ValidationError;
      expect(vError.errors[0]!.path).toBe('user.email');
    }
  });

  it('re-throws non-Zod errors', () => {
    const throwingSchema = z.string().transform(() => {
      throw new TypeError('custom error');
    });

    expect(() => validate(throwingSchema, 'test')).toThrow(TypeError);
  });
});

describe('validateSafe', () => {
  it('returns success result for valid input', () => {
    const result = validateSafe(testSchema, { name: 'Bob', age: 25 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: 'Bob', age: 25 });
    }
  });

  it('returns failure result for invalid input', () => {
    const result = validateSafe(testSchema, { name: '', age: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns errors with path and message', () => {
    const result = validateSafe(testSchema, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      for (const error of result.errors) {
        expect(error).toHaveProperty('path');
        expect(error).toHaveProperty('message');
      }
    }
  });

  it('handles nested path errors', () => {
    const nestedSchema = z.object({
      deep: z.object({
        value: z.number(),
      }),
    });
    const result = validateSafe(nestedSchema, {
      deep: { value: 'not-number' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]!.path).toBe('deep.value');
    }
  });
});
