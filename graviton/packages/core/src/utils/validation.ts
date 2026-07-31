import { ZodSchema, ZodError } from 'zod';

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string; message: string }>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate data against a Zod schema
 * Throws ValidationError if validation fails
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      }));
      throw new ValidationError('Validation failed', errors);
    }
    throw error;
  }
}

/**
 * Safe validation that returns result object instead of throwing
 */
export function validateSafe<T>(
  schema: ZodSchema<T>,
  data: unknown
):
  | { success: true; data: T }
  | { success: false; errors: Array<{ path: string; message: string }> } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.errors.map((err) => ({
      path: err.path.join('.'),
      message: err.message,
    })),
  };
}
