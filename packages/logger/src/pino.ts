import { pino } from 'pino';
import type { CreateLoggerOptions } from './types';

export function createLogger(options: CreateLoggerOptions) {
  // @ts-ignore
  const pretty = options?.pretty && process.NODE_ENV !== 'production';
  const baseOptions = pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : {};
  return pino({
    ...baseOptions,
    formatters: {
      bindings() {
        return { nodeVersion: process.version };
      },
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
  });
}
