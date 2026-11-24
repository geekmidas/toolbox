import { describe, expect, it } from 'vitest';
import { isFake } from '../fake';
import {
	defaultMapsHandler,
	encodePolyline,
	FAKE_MAPS_KEY,
	mapsFake,
} from '../maps/fake';

/** The default Maps fake, asked directly as a client's requests ask it. */

const ask = (path: string, init: RequestInit = {}, key = true) =>
	defaultMapsHandler.fetch(
		new Request(`https://maps.googleapis.com${path}`, {
			...init,
			headers: {
				...(key ? { 'x-goog-api-key': 'k' } : {}),
				...(init.body ? { 'content-type': 'application/json' } : {}),
			},
		}),
	);

const post = (path: string, body: unknown) =>
	ask(path, { method: 'POST', body: JSON.stringify(body) });

describe('the default Maps fake', () => {
	it('answers the same point for the same address, however it is written', async () => {
		const first = await (
			await ask('/maps/api/geocode/json?address=Woodstock')
		).json();
		const again = await (
			await ask('/maps/api/geocode/json?address=%20woodstock%20')
		).json();

		expect(first.results[0].geometry).toEqual(again.results[0].geometry);
	});

	it('answers a point it is asked about as its own address', async () => {
		const body = await (
			await ask('/maps/api/geocode/json?latlng=-33.9,18.4')
		).json();

		expect(body.results[0]).toMatchObject({
			formatted_address: '-33.9,18.4',
			geometry: { location: { lat: -33.9, lng: 18.4 } },
		});
	});

	it('refuses geocoding with neither an address nor a point', async () => {
		const body = await (await ask('/maps/api/geocode/json')).json();

		expect(body.status).toBe('INVALID_REQUEST');
	});

	it.for([
		{
			name: 'geocoding',
			path: '/maps/api/geocode/json?address=x',
			status: 200,
		},
		{ name: 'places', path: '/v1/places/p1', status: 403 },
	])('refuses $name without a key, as Google does', async ({
		path,
		status,
	}) => {
		const response = await ask(path, {}, false);

		expect(response.status).toBe(status);
	});

	it('takes the key from the query, as geocoding sends it', async () => {
		const response = await defaultMapsHandler.fetch(
			new Request(
				'https://maps.googleapis.com/maps/api/geocode/json?address=x&key=k',
			),
		);

		expect((await response.json()).status).toBe('OK');
	});

	it('finds a place named as the search was', async () => {
		const body = await (
			await post('/v1/places:searchText', { textQuery: 'coffee' })
		).json();

		expect(body.places[0]).toMatchObject({
			id: 'fake-coffee',
			displayName: { text: 'coffee' },
		});
	});

	it('refuses a search with no text', async () => {
		const response = await post('/v1/places:searchText', {});

		expect(response.status).toBe(400);
	});

	it("answers a place's details by the id a search gave", async () => {
		const body = await (await ask('/v1/places/fake-coffee')).json();

		expect(body).toMatchObject({
			id: 'fake-coffee',
			formattedAddress: 'coffee',
		});
	});

	it('routes between two points, as long as the distance between them', async () => {
		const body = await (
			await post('/directions/v2:computeRoutes', {
				origin: { location: { latLng: { latitude: 0, longitude: 0 } } },
				destination: { location: { latLng: { latitude: 0, longitude: 1 } } },
			})
		).json();

		expect(body.routes[0]).toEqual({
			distanceMeters: 111195,
			duration: '8000s',
			polyline: {
				encodedPolyline: encodePolyline([
					{ lat: 0, lng: 0 },
					{ lat: 0, lng: 1 },
				]),
			},
		});
	});

	it('routes between addresses and place ids', async () => {
		const body = await (
			await post('/directions/v2:computeRoutes', {
				origin: { address: 'Woodstock' },
				destination: { placeId: 'fake-observatory' },
			})
		).json();

		expect(body.routes[0].distanceMeters).toBeGreaterThan(0);
	});

	it('refuses a route with no destination', async () => {
		const response = await post('/directions/v2:computeRoutes', {
			origin: { address: 'a' },
		});

		expect(response.status).toBe(400);
	});

	it('draws a static map as a PNG', async () => {
		const response = await ask('/maps/api/staticmap?center=x');

		expect(response.headers.get('content-type')).toBe('image/png');
	});

	it('answers a path it does not know with 404', async () => {
		const response = await ask('/v1/elsewhere');

		expect(response.status).toBe(404);
	});
});

describe('encodePolyline', () => {
	it("encodes Google's own example", () => {
		expect(
			encodePolyline([
				{ lat: 38.5, lng: -120.2 },
				{ lat: 40.7, lng: -120.95 },
				{ lat: 43.252, lng: -126.453 },
			]),
		).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
	});
});

describe('mapsFake', () => {
	it('is an app fake with the default handler and the fake key', () => {
		const fake = mapsFake();

		expect({
			isFake: isFake(fake),
			kind: fake.kind,
			handler: fake.kind === 'app' ? fake.handler : undefined,
			credentials: fake.credentials,
		}).toEqual({
			isFake: true,
			kind: 'app',
			handler: defaultMapsHandler,
			credentials: FAKE_MAPS_KEY,
		});
	});

	it('answers with the handler it is given', () => {
		const handler = { fetch: () => new Response('mine') };

		expect(mapsFake(handler)).toMatchObject({ handler });
	});
});
