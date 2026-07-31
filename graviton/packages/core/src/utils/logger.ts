import pino from 'pino';

/**
 * Create a logger instance with the specified name
 */
export function createLogger(name: string, level: string = 'info') {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  return pino({
    name,
    level,
    transport: isDevelopment
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
  });
}

/**
 * Default logger instance
 */
export const logger = createLogger('graviton');
