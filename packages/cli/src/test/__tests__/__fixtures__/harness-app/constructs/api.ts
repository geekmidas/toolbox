import { RestApi } from '@geekmidas/constructs/rest-api';
import { auth } from './auth.js';

export const api = new RestApi('Api', {
	path: 'apps/api',
	defaultAuthorizer: 'none',
}).auth(auth);
