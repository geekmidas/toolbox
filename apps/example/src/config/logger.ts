import { LogLevel } from '@geekmidas/logger';
import { createLogger } from '@geekmidas/logger/pino';

const logger = createLogger({
  level: LogLevel.Info,
  pretty: true,
});

export default logger;
