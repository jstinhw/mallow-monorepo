import { describe, it, expect, afterEach } from 'vitest';
import { createLogger, logger } from './logger.js';

describe('createLogger', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('creates a logger with the given name', () => {
    const log = createLogger('test-logger');
    expect(log).toBeDefined();
  });

  it('creates a logger with custom level', () => {
    const log = createLogger('test', 'debug');
    expect(log.level).toBe('debug');
  });

  it('defaults to info level', () => {
    const log = createLogger('test');
    expect(log.level).toBe('info');
  });

  it('has standard logging methods', () => {
    const log = createLogger('test');
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.debug).toBe('function');
  });
});

describe('default logger', () => {
  it('is exported and defined', () => {
    expect(logger).toBeDefined();
  });

  it('has info level by default', () => {
    expect(logger.level).toBe('info');
  });
});
