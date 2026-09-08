/**
 * Test endpoint without any services.
 * getEnvironment() should return [].
 */

import { RestApi } from '@geekmidas/constructs/rest-api';
import { z } from 'zod';

/** Endpoints are built from a surface now. */
const api = new RestApi('Test', { default: 'none' });

export const healthCheck = api
	.get('/health')
	.output(z.object({ status: z.string() }))
	.handle(async () => {
		return { status: 'ok' };
	});
