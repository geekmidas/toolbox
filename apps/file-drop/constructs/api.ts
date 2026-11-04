import { RestApi } from '@geekmidas/constructs/rest-api';
import { LogLevel } from '@geekmidas/logger';
import { createLogger } from '@geekmidas/logger/pino';

export const api = new RestApi('Api', {
	path: 'apps/api',
	defaultAuthorizer: 'none',
	logger: createLogger({ level: LogLevel.Info }),
});
