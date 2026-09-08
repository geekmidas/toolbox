import { z } from 'zod';
import { router } from './router.js';

/** Public health check. */
export const health = router
	.get('/health')
	.output(
		z.object({
			status: z.literal('ok'),
			timestamp: z.string(),
		}),
	)
	.handle(async () => ({
		status: 'ok' as const,
		timestamp: new Date().toISOString(),
	}));
