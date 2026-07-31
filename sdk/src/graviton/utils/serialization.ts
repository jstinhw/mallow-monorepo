/**
 * Recursively convert all bigint values in an object to strings
 * This is necessary because JSON.stringify doesn't handle bigint natively
 */
export function serializeBigInt<T>(obj: T): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'bigint') {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => serializeBigInt(item));
  }

  if (typeof obj === 'object') {
    const serialized: any = {};
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        serialized[key] = serializeBigInt(obj[key]);
      }
    }
    return serialized;
  }

  return obj;
}

const BIGINT_FIELDS = new Set(['chainId', 'nonce', 'amount', 'value']);

/**
 * Recursively convert string values back to bigint for known bigint fields.
 * This reverses the serializeBigInt transformation on API responses.
 */
export function deserializeBigInt<T>(obj: T): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deserializeBigInt(item));
  }

  if (typeof obj === 'object') {
    const deserialized: any = {};
    for (const key in obj as any) {
      if (Object.hasOwn(obj, key)) {
        const val = (obj as any)[key];
        if (BIGINT_FIELDS.has(key) && typeof val === 'string') {
          deserialized[key] = BigInt(val);
        } else {
          deserialized[key] = deserializeBigInt(val);
        }
      }
    }
    return deserialized;
  }

  return obj;
}
