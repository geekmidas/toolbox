/**
 * Test endpoint with database service.
 * getEnvironment() should return ['DATABASE_URL', 'DB_POOL_SIZE'].
 */

import { RestApi } from '@geekmidas/constructs/rest-api';
import { z } from 'zod';
import { databaseService } from '../services';

/** Endpoints are built from a surface now. */
const api = new RestApi('Test', { default: 'none' });

export const getUsers = api.endpoints
	.services([databaseService])
	.get('/users')
	.output(z.array(z.object({ id: z.string(), name: z.string() })))
	.handle(async () => {
		return [{ id: '1', name: 'Test User' }];
	});
