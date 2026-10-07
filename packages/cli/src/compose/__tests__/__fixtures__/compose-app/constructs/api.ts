import { RestApi } from '@geekmidas/constructs/rest-api';
import { auth } from './auth.js';
import { logger } from './logger.js';

/** Authenticated by the auth server, which it calls across the network. */
export const api = new RestApi('Api', {
	path: 'apps/api',
	defaultAuthorizer: 'none',
	logger,
}).auth(auth);
