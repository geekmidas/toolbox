/**
 * Test endpoint with database service.
 * getEnvironment() should return ['DATABASE_URL', 'DB_POOL_SIZE'].
 */
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';
import { databaseService } from '../services';

export const getUsers = e
	.services([databaseService])
	.get('/users')
	.output(z.array(z.object({ id: z.string(), name: z.string() })))
	.handle(async () => {
		return [{ id: '1', name: 'Test User' }];
	});
