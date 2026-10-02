import { shipping } from '@kitchen-sink/constructs/shipping.js';
import { z } from 'zod';
import { router } from './router.js';

/**
 * A shipping quote, from the carrier — or, locally and in tests, its fake.
 *
 * `.dependsOn([shipping])` is the whole of the wiring: the handler cannot tell
 * which one answered.
 */
export const quoteShipping = router
	.post('/shipping/quotes')
	.dependsOn([shipping])
	.body(
		z.object({
			destination: z.string().min(1),
			weightKg: z.number().positive(),
		}),
	)
	.output(z.object({ destination: z.string(), amount: z.number() }))
	.handle(async ({ body, services }) =>
		services.shipping.quote(body.destination, body.weightKg),
	);
