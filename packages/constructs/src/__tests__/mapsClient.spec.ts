import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	MAPS_HOST,
	MapsRequestFailed,
	mapsClient,
	PLACES_HOST,
	ROUTES_HOST,
} from '../maps/client';

/**
 * The client a server process is handed: Google's web services, called with
 * its key, answered here by MSW as Google answers them.
 */

const network = setupServer();
beforeAll(() => network.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
	network.resetHandlers();
	network.events.removeAllListeners();
});
afterAll(() => network.close());

const client = mapsClient('AIza-key', [
	'geocoding',
	'places',
	'routes',
	'static-maps',
]);

/** Each request MSW sees from here on, as sent. */
function recording() {
	const seen: Request[] = [];
	network.events.on('request:start', ({ request }) => {
		seen.push(request.clone());
	});
	return seen;
}

describe('geocoding', () => {
	it('answers each result as its address, place and point', async () => {
		network.use(
			http.get(`${MAPS_HOST}/maps/api/geocode/json`, () =>
				HttpResponse.json({
					status: 'OK',
					results: [
						{
							formatted_address: '1 Main Rd, Woodstock',
							place_id: 'abc',
							geometry: { location: { lat: -33.9, lng: 18.4 } },
						},
					],
				}),
			),
		);

		expect(await client.geocode('1 Main Rd')).toEqual([
			{
				formattedAddress: '1 Main Rd, Woodstock',
				placeId: 'abc',
				location: { lat: -33.9, lng: 18.4 },
				types: [],
			},
		]);
	});

	it('sends the address, region, language and key', async () => {
		const seen = recording();
		network.use(
			http.get(`${MAPS_HOST}/maps/api/geocode/json`, () =>
				HttpResponse.json({ status: 'ZERO_RESULTS', results: [] }),
			),
		);

		await client.geocode('1 Main Rd', { region: 'za', language: 'af' });

		expect(Object.fromEntries(new URL(seen[0]!.url).searchParams)).toEqual({
			address: '1 Main Rd',
			region: 'za',
			language: 'af',
			key: 'AIza-key',
		});
	});

	it('reverse-geocodes a point as latlng', async () => {
		const seen = recording();
		network.use(
			http.get(`${MAPS_HOST}/maps/api/geocode/json`, () =>
				HttpResponse.json({ status: 'ZERO_RESULTS', results: [] }),
			),
		);

		await client.reverseGeocode({ lat: -33.9, lng: 18.4 });

		expect(new URL(seen[0]!.url).searchParams.get('latlng')).toBe('-33.9,18.4');
	});

	it('answers no results as an empty list', async () => {
		network.use(
			http.get(`${MAPS_HOST}/maps/api/geocode/json`, () =>
				HttpResponse.json({ status: 'ZERO_RESULTS', results: [] }),
			),
		);

		expect(await client.geocode('nowhere')).toEqual([]);
	});

	it('refuses an error status Google answers 200 with, saying why', async () => {
		network.use(
			http.get(`${MAPS_HOST}/maps/api/geocode/json`, () =>
				HttpResponse.json({
					status: 'REQUEST_DENIED',
					error_message: 'This API project is not authorized.',
				}),
			),
		);

		const error = await client.geocode('x').catch((e: unknown) => e);

		expect(error).toMatchObject({
			name: 'MapsRequestFailed',
			api: 'geocoding',
			status: 200,
			detail: 'REQUEST_DENIED: This API project is not authorized.',
			message: expect.stringContaining('declare this API on the construct'),
		});
	});

	it('names a status-less answer', async () => {
		network.use(
			http.get(`${MAPS_HOST}/maps/api/geocode/json`, () =>
				HttpResponse.json({}),
			),
		);

		await expect(client.geocode('x')).rejects.toMatchObject({
			detail: 'NO_STATUS',
		});
	});
});

describe('places', () => {
	it('searches with the default field mask, the key in a header', async () => {
		const seen = recording();
		network.use(
			http.post(`${PLACES_HOST}/v1/places:searchText`, () =>
				HttpResponse.json({ places: [{ id: 'p1' }] }),
			),
		);

		const places = await client.searchPlaces('coffee', { maxResultCount: 3 });
		const request = seen[0]!;

		expect({
			places,
			key: request.headers.get('x-goog-api-key'),
			mask: request.headers.get('x-goog-fieldmask'),
			body: await request.json(),
		}).toEqual({
			places: [{ id: 'p1' }],
			key: 'AIza-key',
			mask: 'places.id,places.displayName,places.formattedAddress,places.location',
			body: { textQuery: 'coffee', maxResultCount: 3 },
		});
	});

	it('asks for the fields given, and answers none as an empty list', async () => {
		const seen = recording();
		network.use(
			http.post(`${PLACES_HOST}/v1/places:searchText`, () =>
				HttpResponse.json({}),
			),
		);

		const places = await client.searchPlaces('coffee', {
			fields: ['places.rating'],
		});

		expect({
			places,
			mask: seen[0]!.headers.get('x-goog-fieldmask'),
		}).toEqual({ places: [], mask: 'places.rating' });
	});

	it("reads one place's details, by its id", async () => {
		const seen = recording();
		network.use(
			http.get(`${PLACES_HOST}/v1/places/:id`, ({ params }) =>
				HttpResponse.json({ id: params.id }),
			),
		);

		const place = await client.placeDetails('a/b', {
			languageCode: 'af',
			fields: ['id'],
		});
		const url = new URL(seen[0]!.url);

		expect({
			place,
			path: url.pathname,
			language: url.searchParams.get('languageCode'),
			mask: seen[0]!.headers.get('x-goog-fieldmask'),
		}).toEqual({
			place: { id: 'a/b' },
			path: '/v1/places/a%2Fb',
			language: 'af',
			mask: 'id',
		});
	});

	it('asks for the default fields of a place', async () => {
		const seen = recording();
		network.use(
			http.get(`${PLACES_HOST}/v1/places/:id`, () => HttpResponse.json({})),
		);

		await client.placeDetails('p1');

		expect(seen[0]!.headers.get('x-goog-fieldmask')).toBe(
			'id,displayName,formattedAddress,location',
		);
	});

	it("refuses Google's error, with its status and message", async () => {
		network.use(
			http.post(`${PLACES_HOST}/v1/places:searchText`, () =>
				HttpResponse.json(
					{
						error: {
							code: 403,
							status: 'PERMISSION_DENIED',
							message: 'Places API (New) has not been used.',
						},
					},
					{ status: 403 },
				),
			),
		);

		await expect(client.searchPlaces('x')).rejects.toMatchObject({
			api: 'places',
			status: 403,
			detail: 'PERMISSION_DENIED: Places API (New) has not been used.',
		});
	});
});

describe('routes', () => {
	it.for([
		{
			name: 'an address',
			waypoint: 'Woodstock',
			sent: { address: 'Woodstock' },
		},
		{
			name: 'a point',
			waypoint: { lat: -33.9, lng: 18.4 },
			sent: { location: { latLng: { latitude: -33.9, longitude: 18.4 } } },
		},
		{
			name: 'a place id',
			waypoint: { placeId: 'p1' },
			sent: { placeId: 'p1' },
		},
	])('sends $name as Routes takes it', async ({ waypoint, sent }) => {
		const seen = recording();
		network.use(
			http.post(`${ROUTES_HOST}/directions/v2:computeRoutes`, () =>
				HttpResponse.json({}),
			),
		);

		await client.computeRoutes({ origin: waypoint, destination: waypoint });

		expect(await seen[0]!.json()).toEqual({
			origin: sent,
			destination: sent,
			travelMode: 'DRIVE',
		});
	});

	it('answers its routes, asking for the fields given', async () => {
		const seen = recording();
		network.use(
			http.post(`${ROUTES_HOST}/directions/v2:computeRoutes`, () =>
				HttpResponse.json({ routes: [{ distanceMeters: 1200 }] }),
			),
		);

		const routes = await client.computeRoutes({
			origin: 'a',
			destination: 'b',
			travelMode: 'WALK',
			fields: ['routes.distanceMeters'],
		});

		expect({
			routes,
			mask: seen[0]!.headers.get('x-goog-fieldmask'),
		}).toEqual({
			routes: [{ distanceMeters: 1200 }],
			mask: 'routes.distanceMeters',
		});
	});

	it('names a body that is not JSON', async () => {
		network.use(
			http.post(
				`${ROUTES_HOST}/directions/v2:computeRoutes`,
				() => new HttpResponse('upstream broke', { status: 502 }),
			),
		);

		await expect(
			client.computeRoutes({ origin: 'a', destination: 'b' }),
		).rejects.toMatchObject({ status: 502, detail: 'upstream broke' });
	});

	it('names an empty error body', async () => {
		network.use(
			http.post(
				`${ROUTES_HOST}/directions/v2:computeRoutes`,
				() => new HttpResponse(null, { status: 500 }),
			),
		);

		await expect(
			client.computeRoutes({ origin: 'a', destination: 'b' }),
		).rejects.toMatchObject({ detail: 'no body' });
	});

	it('names a JSON error that is not Google’s shape', async () => {
		network.use(
			http.post(`${ROUTES_HOST}/directions/v2:computeRoutes`, () =>
				HttpResponse.json({ oops: true }, { status: 500 }),
			),
		);

		await expect(
			client.computeRoutes({ origin: 'a', destination: 'b' }),
		).rejects.toMatchObject({ detail: '{"oops":true}' });
	});
});

describe('static maps', () => {
	it('builds a keyed URL with every option', () => {
		const url = new URL(
			client.staticMapUrl({
				center: { lat: -33.9, lng: 18.4 },
				zoom: 14,
				size: { width: 600, height: 300 },
				markers: ['Woodstock', { lat: -33.93, lng: 18.45 }],
				scale: 2,
				mapType: 'terrain',
			}),
		);

		expect({
			origin: url.origin,
			path: url.pathname,
			params: [...url.searchParams],
		}).toEqual({
			origin: MAPS_HOST,
			path: '/maps/api/staticmap',
			params: [
				['center', '-33.9,18.4'],
				['zoom', '14'],
				['size', '600x300'],
				['scale', '2'],
				['maptype', 'terrain'],
				['markers', 'Woodstock'],
				['markers', '-33.93,18.45'],
				['key', 'AIza-key'],
			],
		});
	});

	it('leaves out the options not given', () => {
		const url = new URL(
			client.staticMapUrl({
				center: 'Woodstock',
				zoom: 10,
				size: { width: 100, height: 100 },
			}),
		);

		expect([...url.searchParams.keys()]).toEqual([
			'center',
			'zoom',
			'size',
			'key',
		]);
	});
});

describe('the APIs a construct declares', () => {
	it('has a method only for the web services declared', () => {
		const only = mapsClient('k', ['geocoding', 'maps']);

		expect(
			Object.keys(only)
				.filter((key) => typeof (only as never)[key] === 'function')
				.sort(),
		).toEqual(['geocode', 'reverseGeocode']);
	});

	it('names what a refused key is restricted to', () => {
		const error = new MapsRequestFailed('routes', 403, 'PERMISSION_DENIED');

		expect(error.message).toContain('restricted to the APIs');
	});

	it('adds no hint to an error that is not a refusal', () => {
		const error = new MapsRequestFailed('routes', 500, 'INTERNAL');

		expect(error.message).toBe("Google's routes API answered 500: INTERNAL");
	});
});
