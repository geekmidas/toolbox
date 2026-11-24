import { describe, expectTypeOf, it } from 'vitest';
import { type GeocodeResult, Maps, type MapsClient } from '../maps';
import type { ClientOf } from '../testing/featureTest';

/**
 * A `Maps` client has a method only for the web services its construct
 * declares — so a call its key is not restricted to does not build.
 */

describe('a Maps client', () => {
	it('has the methods of the APIs declared', () => {
		const maps = new Maps('Maps', { apis: ['geocoding', 'maps'] });
		type Client = ClientOf<typeof maps>;

		expectTypeOf<Client['geocode']>().returns.resolves.toEqualTypeOf<
			GeocodeResult[]
		>();
		expectTypeOf<Client['apiKey']>().toEqualTypeOf<string>();
	});

	it('has no method of an API not declared', () => {
		const maps = new Maps('Maps', { apis: ['geocoding'] });
		type Client = ClientOf<typeof maps>;

		expectTypeOf<Client>().not.toHaveProperty('computeRoutes');
		expectTypeOf<Client>().not.toHaveProperty('searchPlaces');
		expectTypeOf<Client>().not.toHaveProperty('staticMapUrl');
	});

	it('has every method when nothing narrows it', () => {
		expectTypeOf<MapsClient>().toHaveProperty('computeRoutes');
		expectTypeOf<MapsClient>().toHaveProperty('staticMapUrl');
	});

	it("is the handler's service, under the construct's name", () => {
		const maps = new Maps('Places', { apis: ['places'] });

		expectTypeOf(maps.service.serviceName).toEqualTypeOf<'places'>();
	});
});
