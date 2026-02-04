import { z } from 'zod';
import { DummyService } from '../services/DummyService';
import { router } from './router';

/**
 * Health check endpoint
 */
export const health = router
	.get('/health')
	.services([DummyService])
	.output(
		z.object({
			status: z.literal('ok'),
			timestamp: z.string(),
			version: z.string(),
		}),
	)
	.handle(async () => {
		return {
			status: 'ok' as const,
			timestamp: new Date().toISOString(),
			version: '1.0.0',
		};
	});
