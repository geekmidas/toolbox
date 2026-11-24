import { maps } from '@kitchen-sink/constructs/maps.js';
import { z } from 'zod';
import { router } from './router.js';

/**
 * Where an address is, from Google's geocoding — or, under `gkm test`, the
 * fake that answers Google's hosts in-process.
 *
 * `.dependsOn([maps])` hands the handler a client with a method for each web
 * service the construct declares, called with this process's own key.
 */
export const geocodeAddress = router
	.post('/places/geocode')
	.dependsOn([maps])
	.body(z.object({ address: z.string().min(1) }))
	.output(
		z.object({
			results: z
				.object({ address: z.string(), lat: z.number(), lng: z.number() })
				.array(),
		}),
	)
	.handle(async ({ body, services }) => {
		const results = await services.maps.geocode(body.address);
		return {
			results: results.map((result) => ({
				address: result.formattedAddress,
				...result.location,
			})),
		};
	});
