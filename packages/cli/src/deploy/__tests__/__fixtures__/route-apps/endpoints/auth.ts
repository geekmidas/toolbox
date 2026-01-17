/**
 * Test endpoint with multiple services.
 * getEnvironment() should return ['AUTH_SECRET', 'AUTH_URL', 'DATABASE_URL', 'DB_POOL_SIZE'].
 */
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';
import { authService, databaseService } from '../services';

export const login = e
	.services([databaseService, authService])
	.post('/auth/login')
	.body(z.object({ email: z.string(), password: z.string() }))
	.output(z.object({ token: z.string() }))
	.handle(async () => {
		return { token: 'test-token' };
	});
