/**
 * Test endpoint with multiple services.
 * getEnvironment() should return ['AUTH_SECRET', 'AUTH_URL', 'DATABASE_URL', 'DB_POOL_SIZE'].
 */

import { RestApi } from '@geekmidas/constructs/rest-api';
import { z } from 'zod';
import { authService, databaseService } from '../services';

/** Endpoints are built from a surface now. */
const api = new RestApi('Test', { default: 'none' });

export const login = api.endpoints
	.services([databaseService, authService])
	.post('/auth/login')
	.body(z.object({ email: z.string(), password: z.string() }))
	.output(z.object({ token: z.string() }))
	.handle(async () => {
		return { token: 'test-token' };
	});
