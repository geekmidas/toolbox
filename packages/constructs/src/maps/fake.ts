/**
 * A `Maps` construct's fake: Google's Maps web services, answered in-process
 * under `gkm test`, so a suite needs no key and spends no quota.
 *
 * Every `Maps` gets {@link defaultMapsHandler} without anything written. A
 * project that wants other answers default-exports its own from
 * `test/fakes/<id>.ts`:
 *
 * ```ts
 * // test/fakes/maps.ts
 * import { defaultMapsHandler, mapsFake } from '@geekmidas/constructs/maps/fake';
 *
 * export default mapsFake({
 *   async fetch(request) {
 *     const url = new URL(request.url);
 *     if (url.searchParams.get('address') === 'nowhere') {
 *       return Response.json({ status: 'ZERO_RESULTS', results: [] });
 *     }
 *     return defaultMapsHandler.fetch(request);
 *   },
 * });
 * ```
 *
 * The answers are deterministic: the same address is always the same point,
 * and a route's length is the distance between its ends.
 */

import type { Fake, FetchHandler } from '../fake';
import { fake } from '../fake';
import type { LatLng } from './client';

/** The key a test stage's Maps processes are handed. */
export const FAKE_MAPS_KEY = 'fake-maps-key';

/** A `Maps` fake, answering with `handler` — the default one when none is given. */
export function mapsFake(handler: FetchHandler = defaultMapsHandler): Fake {
	return fake.app(handler, { credentials: FAKE_MAPS_KEY });
}

/**
 * Geocoding, Places (New), Routes and static maps — routed by path, so the
 * one handler answers every Maps host.
 */
export const defaultMapsHandler: FetchHandler = {
	async fetch(request) {
		const url = new URL(request.url);
		const key =
			request.headers.get('x-goog-api-key') ?? url.searchParams.get('key');
		if (!key) {
			return url.pathname.startsWith('/maps/api/geocode')
				? Response.json({
						status: 'REQUEST_DENIED',
						error_message: 'You must use an API key.',
						results: [],
					})
				: googleError(403, 'PERMISSION_DENIED', 'No API key was sent.');
		}

		if (url.pathname === '/maps/api/geocode/json') return geocode(url);
		if (url.pathname === '/maps/api/staticmap') return staticMap();
		if (url.pathname === '/v1/places:searchText' && request.method === 'POST') {
			return searchText((await request.json()) as { textQuery?: string });
		}
		if (url.pathname.startsWith('/v1/places/') && request.method === 'GET') {
			return placeDetails(
				decodeURIComponent(url.pathname.slice('/v1/places/'.length)),
			);
		}
		if (
			url.pathname === '/directions/v2:computeRoutes' &&
			request.method === 'POST'
		) {
			return computeRoutes((await request.json()) as RoutesBody);
		}
		return googleError(
			404,
			'NOT_FOUND',
			`The Maps fake answers no ${request.method} ${url.pathname}.`,
		);
	},
};

function geocode(url: URL): Response {
	const address = url.searchParams.get('address');
	const latlng = url.searchParams.get('latlng');
	if (!address && !latlng) {
		return Response.json({
			status: 'INVALID_REQUEST',
			error_message:
				'Invalid request. Missing the address or latlng parameter.',
			results: [],
		});
	}
	const location = latlng ? parseLatLng(latlng) : pointFor(address!);
	const formatted = address ?? `${location.lat},${location.lng}`;
	return Response.json({
		status: 'OK',
		results: [
			{
				formatted_address: formatted,
				place_id: placeIdFor(formatted),
				geometry: { location },
				types: ['street_address'],
			},
		],
	});
}

function searchText(body: { textQuery?: string }): Response {
	if (!body.textQuery) {
		return googleError(400, 'INVALID_ARGUMENT', 'textQuery is required.');
	}
	return Response.json({ places: [placeFor(body.textQuery)] });
}

function placeDetails(id: string): Response {
	return Response.json(placeFor(id.replace(/^fake-/, ''), id));
}

type RawWaypoint = {
	address?: string;
	placeId?: string;
	location?: { latLng?: { latitude: number; longitude: number } };
};

interface RoutesBody {
	origin?: RawWaypoint;
	destination?: RawWaypoint;
}

function computeRoutes(body: RoutesBody): Response {
	if (!body.origin || !body.destination) {
		return googleError(
			400,
			'INVALID_ARGUMENT',
			'origin and destination are required.',
		);
	}
	const from = waypointPoint(body.origin);
	const to = waypointPoint(body.destination);
	const distanceMeters = Math.round(haversine(from, to));
	// A city's pace: 50 km/h.
	const seconds = Math.round(distanceMeters / 13.9);
	return Response.json({
		routes: [
			{
				distanceMeters,
				duration: `${seconds}s`,
				polyline: { encodedPolyline: encodePolyline([from, to]) },
			},
		],
	});
}

/** A 1×1 transparent PNG. */
function staticMap(): Response {
	const png = Uint8Array.from(
		atob(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
		),
		(c) => c.charCodeAt(0),
	);
	return new Response(png, { headers: { 'content-type': 'image/png' } });
}

function googleError(code: number, status: string, message: string): Response {
	return Response.json({ error: { code, status, message } }, { status: code });
}

function placeFor(text: string, id = placeIdFor(text)) {
	const point = pointFor(text);
	return {
		id,
		displayName: { text, languageCode: 'en' },
		formattedAddress: text,
		location: { latitude: point.lat, longitude: point.lng },
	};
}

function waypointPoint(point: RawWaypoint): LatLng {
	const latLng = point.location?.latLng;
	if (latLng) return { lat: latLng.latitude, lng: latLng.longitude };
	return pointFor(point.address ?? point.placeId?.replace(/^fake-/, '') ?? '');
}

function parseLatLng(value: string): LatLng {
	const [lat, lng] = value.split(',').map(Number);
	return { lat: lat ?? 0, lng: lng ?? 0 };
}

/** A stable 32-bit hash of `text`. */
function hash(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** The same point for the same text, somewhere around Cape Town. */
function pointFor(text: string): LatLng {
	const h = hash(text.trim().toLowerCase());
	const round = (n: number) => Math.round(n * 1e6) / 1e6;
	return {
		lat: round(-33.9 + ((h & 0xffff) / 0xffff - 0.5) * 0.4),
		lng: round(18.4 + ((h >>> 16) / 0xffff - 0.5) * 0.4),
	};
}

function placeIdFor(text: string): string {
	return `fake-${text.trim().toLowerCase().replace(/\s+/g, '-')}`;
}

function haversine(a: LatLng, b: LatLng): number {
	const rad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Google's encoded polyline of `points`. */
export function encodePolyline(points: readonly LatLng[]): string {
	let out = '';
	let lastLat = 0;
	let lastLng = 0;
	for (const point of points) {
		const lat = Math.round(point.lat * 1e5);
		const lng = Math.round(point.lng * 1e5);
		out += encodeNumber(lat - lastLat) + encodeNumber(lng - lastLng);
		lastLat = lat;
		lastLng = lng;
	}
	return out;
}

function encodeNumber(value: number): string {
	let n = value < 0 ? ~(value << 1) : value << 1;
	let out = '';
	while (n >= 0x20) {
		out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
		n >>= 5;
	}
	return out + String.fromCharCode(n + 63);
}
