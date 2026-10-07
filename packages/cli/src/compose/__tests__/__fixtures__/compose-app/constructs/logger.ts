import { type Logger, LogLevel } from '@geekmidas/logger';
import { createLogger } from '@geekmidas/logger/pino';

/**
 * Pino, through `createLogger`: with telemetry exported, each record also goes
 * over OTLP in its request's trace — which the stack's OpenObserve is asked
 * for.
 */
export const logger: Logger = createLogger({ level: LogLevel.Info });
