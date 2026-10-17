import { realtime } from '@kitchen-sink/constructs/realtime.js';
import { z } from 'zod';
import { router } from './router.js';

/**
 * An announcement to everyone connected to the realtime surface — sent from
 * the API, which holds no socket of its own.
 */
export const announce = router
	.post('/announcements')
	.dependsOn([realtime])
	.body(z.object({ text: z.string().min(1).max(500) }))
	.output(z.object({ sent: z.boolean() }))
	.handle(async ({ body, services }) => {
		await services.realtime.broadcast({
			action: 'announcement',
			data: { text: body.text },
		});
		return { sent: true };
	});
