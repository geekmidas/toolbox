/**
 * Test endpoint without any services.
 * getEnvironment() should return [].
 */
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod';

export const healthCheck = e
	.get('/health')
	.output(z.object({ status: z.string() }))
	.handle(async () => {
		return { status: 'ok' };
	});
