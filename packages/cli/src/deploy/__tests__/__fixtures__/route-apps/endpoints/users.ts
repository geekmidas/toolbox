/**
 * Test endpoint with database service.
 * getEnvironment() should return ['DATABASE_URL', 'DB_POOL_SIZE'].
 */

import { RestApi } from '@geekmidas/constructs/rest-api';
import { z } from 'zod';
import { databaseService } from '../services';

/** Endpoints are built from a surface now. */
const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });

export const getUsers = api
	.get('/users')
	.services([databaseService])
	.output(z.array(z.object({ id: z.string(), name: z.string() })))
	.handle(async () => {
		return [{ id: '1', name: 'Test User' }];
	});
