import { RestApi } from '@geekmidas/constructs/rest-api';
import { auth } from './auth.js';
import { logger } from './logger.js';

export const api = new RestApi('Api', {
	path: 'apps/api',
	defaultAuthorizer: 'none',
	logger,
}).auth(auth);
