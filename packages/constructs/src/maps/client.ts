/**
 * What a server process that depends on a `Maps` is handed: a client for the
 * web services it declared, called with its own key.
 *
 * Only the APIs the construct names exist on it — `new Maps('Maps', { apis:
 * ['geocoding'] })` hands a client with `geocode` and no `computeRoutes` — so
 * a call the key is not restricted to is a type error, not a 403 in
 * production. `apiKey` stays on it for anything this does not cover.
 *
 * Google's hosts are fixed: nothing here is configured per stage. Under
 * `gkm test` the same hosts are answered in-process by the construct's fake.
 */

import type { MapsApi } from '@geekmidas/manifest';

/** Where the geocoding and static maps web services answer. */
export const MAPS_HOST = 'https://maps.googleapis.com';
/** Where Places API (New) answers. */
export const PLACES_HOST = 'https://places.googleapis.com';
/** Where the Routes API answers. */
export const ROUTES_HOST = 'https://routes.googleapis.com';

/** Every host a `Maps` client calls — what its fake answers under `gkm test`. */
export const MAPS_HOSTS = [MAPS_HOST, PLACES_HOST, ROUTES_HOST] as const;

/** A point, in degrees. */
export interface LatLng {
	lat: number;
	lng: number;
}

/** A point Places and Routes answer with. */
export interface GoogleLatLng {
	latitude: number;
	longitude: number;
}

/** One geocoding answer. */
export interface GeocodeResult {
	formattedAddress: string;
	placeId: string;
	location: LatLng;
	types: string[];
}

export interface GeocodeOptions {
	/** A ccTLD region code to bias toward: `za`, `us`. */
	region?: string;
	/** The language to answer in: `en`, `af`. */
	language?: string;
}

/** A place, as Places API (New) answers — the fields the mask asked for. */
export interface Place {
	id?: string;
	displayName?: { text: string; languageCode?: string };
	formattedAddress?: string;
	location?: GoogleLatLng;
	[field: string]: unknown;
}

export interface SearchPlacesOptions {
	/**
	 * The fields to answer with, as Places names them. Places requires a field
	 * mask, and bills by it. Defaults to id, display name, address and location.
	 */
	fields?: readonly string[];
	/** At most this many places, 1 to 20. */
	maxResultCount?: number;
	languageCode?: string;
	regionCode?: string;
}

export interface PlaceDetailsOptions {
	/** As for {@link SearchPlacesOptions.fields}, without the `places.` prefix. */
	fields?: readonly string[];
	languageCode?: string;
}

/** Where a route starts or ends: an address, a point, or a place id. */
export type Waypoint = string | LatLng | { placeId: string };

export type TravelMode =
	| 'DRIVE'
	| 'BICYCLE'
	| 'WALK'
	| 'TWO_WHEELER'
	| 'TRANSIT';

export interface ComputeRoutesOptions {
	origin: Waypoint;
	destination: Waypoint;
	/** Defaults to `DRIVE`. */
	travelMode?: TravelMode;
	/**
	 * The fields to answer with, as Routes names them. Routes requires a field
	 * mask. Defaults to distance, duration and the encoded polyline.
	 */
	fields?: readonly string[];
}

/** A route, as the Routes API answers — the fields the mask asked for. */
export interface Route {
	distanceMeters?: number;
	/** Seconds, as Google writes them: `"1234s"`. */
	duration?: string;
	polyline?: { encodedPolyline: string };
	[field: string]: unknown;
}

export interface StaticMapOptions {
	center: string | LatLng;
	zoom: number;
	size: { width: number; height: number };
	/** Pins, each an address or a point. */
	markers?: readonly (string | LatLng)[];
	/** 1 or 2: 2 for a high-density screen. */
	scale?: 1 | 2;
	mapType?: 'roadmap' | 'satellite' | 'terrain' | 'hybrid';
}

interface GeocodingMethods {
	/** The places an address names — empty when Google found none. */
	geocode(address: string, options?: GeocodeOptions): Promise<GeocodeResult[]>;
	/** The addresses at a point — empty when Google found none. */
	reverseGeocode(
		location: LatLng,
		options?: GeocodeOptions,
	): Promise<GeocodeResult[]>;
}

interface PlacesMethods {
	/** Places matching free text: `"coffee in Woodstock"`. */
	searchPlaces(
		textQuery: string,
		options?: SearchPlacesOptions,
	): Promise<Place[]>;
	/** One place, by the id a search or geocode answered with. */
	placeDetails(placeId: string, options?: PlaceDetailsOptions): Promise<Place>;
}

interface RoutesMethods {
	/** Routes between two waypoints — empty when there is none. */
	computeRoutes(options: ComputeRoutesOptions): Promise<Route[]>;
}

interface StaticMapsMethods {
	/**
	 * A static map's URL, carrying the key — for an `<img>` a server renders
	 * or an email embeds. It holds the server key, so it is for markup gkm's
	 * server sends, not for a page's own JavaScript.
	 */
	staticMapUrl(options: StaticMapOptions): string;
}

/**
 * What `services.<maps>` is for a construct that names `TApis`: its key, and
 * a method per web service it declared. `maps` — the map itself — is drawn
 * by a page or a phone, so it adds nothing here.
 */
export type MapsClient<TApis extends MapsApi = MapsApi> = {
	/** The server key: restricted to the declared APIs. */
	apiKey: string;
} & ('geocoding' extends TApis ? GeocodingMethods : unknown) &
	('places' extends TApis ? PlacesMethods : unknown) &
	('routes' extends TApis ? RoutesMethods : unknown) &
	('static-maps' extends TApis ? StaticMapsMethods : unknown);

/** A Maps web service refused a call, or answered with an error. */
export class MapsRequestFailed extends Error {
	constructor(
		/** The API that answered: `geocoding`, `places`, `routes`. */
		readonly api: MapsApi,
		/** The HTTP status — 200 for a geocoding answer whose status is an error. */
		readonly status: number,
		/** What Google said: its status and message. */
		readonly detail: string,
	) {
		super(
			`Google's ${api} API answered ${status}: ${detail}` +
				(status === 403 || /REQUEST_DENIED|PERMISSION_DENIED/.test(detail)
					? '. The key is restricted to the APIs the Maps construct declares ' +
						'and to the process that holds it: declare this API on the ' +
						'construct and deploy, so its key is restricted to it.'
					: ''),
		);
		this.name = 'MapsRequestFailed';
	}
}

const PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'location'];
const ROUTE_FIELDS = [
	'routes.distanceMeters',
	'routes.duration',
	'routes.polyline.encodedPolyline',
];

/**
 * The client for `apiKey`, with a method for each of `apis`.
 *
 * Calls the global `fetch` when each call is made, so whatever stands in for
 * the network — the tracer, a test's interceptor — sees it.
 */
export function mapsClient<TApis extends MapsApi>(
	apiKey: string,
	apis: readonly TApis[],
): MapsClient<TApis> {
	const client: Record<string, unknown> = { apiKey };
	const has = (api: MapsApi) => (apis as readonly MapsApi[]).includes(api);

	if (has('geocoding')) {
		const geocodeBy = async (
			query: Record<string, string>,
			options: GeocodeOptions = {},
		): Promise<GeocodeResult[]> => {
			const url = new URL('/maps/api/geocode/json', MAPS_HOST);
			for (const [name, value] of Object.entries({
				...query,
				...(options.region ? { region: options.region } : {}),
				...(options.language ? { language: options.language } : {}),
				key: apiKey,
			})) {
				url.searchParams.set(name, value);
			}
			const body = (await call('geocoding', url, { method: 'GET' })) as {
				status?: string;
				error_message?: string;
				results?: RawGeocodeResult[];
			};
			if (body.status === 'ZERO_RESULTS') return [];
			if (body.status !== 'OK') {
				throw new MapsRequestFailed(
					'geocoding',
					200,
					[body.status ?? 'NO_STATUS', body.error_message]
						.filter(Boolean)
						.join(': '),
				);
			}
			return (body.results ?? []).map(geocodeResult);
		};
		client.geocode = (address: string, options?: GeocodeOptions) =>
			geocodeBy({ address }, options);
		client.reverseGeocode = (location: LatLng, options?: GeocodeOptions) =>
			geocodeBy({ latlng: `${location.lat},${location.lng}` }, options);
	}

	if (has('places')) {
		client.searchPlaces = async (
			textQuery: string,
			options: SearchPlacesOptions = {},
		): Promise<Place[]> => {
			const { fields, ...rest } = options;
			const body = (await call(
				'places',
				new URL('/v1/places:searchText', PLACES_HOST),
				{
					method: 'POST',
					headers: googleHeaders(
						apiKey,
						(fields ?? PLACE_FIELDS.map((field) => `places.${field}`)).join(
							',',
						),
					),
					body: JSON.stringify({ textQuery, ...rest }),
				},
			)) as { places?: Place[] };
			return body.places ?? [];
		};
		client.placeDetails = async (
			placeId: string,
			options: PlaceDetailsOptions = {},
		): Promise<Place> => {
			const url = new URL(
				`/v1/places/${encodeURIComponent(placeId)}`,
				PLACES_HOST,
			);
			if (options.languageCode) {
				url.searchParams.set('languageCode', options.languageCode);
			}
			return (await call('places', url, {
				method: 'GET',
				headers: googleHeaders(
					apiKey,
					(options.fields ?? PLACE_FIELDS).join(','),
				),
			})) as Place;
		};
	}

	if (has('routes')) {
		client.computeRoutes = async (
			options: ComputeRoutesOptions,
		): Promise<Route[]> => {
			const body = (await call(
				'routes',
				new URL('/directions/v2:computeRoutes', ROUTES_HOST),
				{
					method: 'POST',
					headers: googleHeaders(
						apiKey,
						(options.fields ?? ROUTE_FIELDS).join(','),
					),
					body: JSON.stringify({
						origin: waypoint(options.origin),
						destination: waypoint(options.destination),
						travelMode: options.travelMode ?? 'DRIVE',
					}),
				},
			)) as { routes?: Route[] };
			return body.routes ?? [];
		};
	}

	if (has('static-maps')) {
		client.staticMapUrl = (options: StaticMapOptions): string => {
			const url = new URL('/maps/api/staticmap', MAPS_HOST);
			url.searchParams.set('center', place(options.center));
			url.searchParams.set('zoom', String(options.zoom));
			url.searchParams.set(
				'size',
				`${options.size.width}x${options.size.height}`,
			);
			if (options.scale) url.searchParams.set('scale', String(options.scale));
			if (options.mapType) url.searchParams.set('maptype', options.mapType);
			for (const marker of options.markers ?? []) {
				url.searchParams.append('markers', place(marker));
			}
			url.searchParams.set('key', apiKey);
			return url.toString();
		};
	}

	return client as MapsClient<TApis>;
}

interface RawGeocodeResult {
	formatted_address: string;
	place_id: string;
	geometry: { location: LatLng };
	types?: string[];
}

function geocodeResult(raw: RawGeocodeResult): GeocodeResult {
	return {
		formattedAddress: raw.formatted_address,
		placeId: raw.place_id,
		location: raw.geometry.location,
		types: raw.types ?? [],
	};
}

/** The headers Places (New) and Routes take the key and the mask in. */
function googleHeaders(apiKey: string, fieldMask: string) {
	return {
		'content-type': 'application/json',
		'x-goog-api-key': apiKey,
		'x-goog-fieldmask': fieldMask,
	};
}

/** A waypoint as Routes takes it. */
function waypoint(point: Waypoint): Record<string, unknown> {
	if (typeof point === 'string') return { address: point };
	if ('placeId' in point) return { placeId: point.placeId };
	return {
		location: { latLng: { latitude: point.lat, longitude: point.lng } },
	};
}

/** A center or marker as the static maps API takes it. */
function place(point: string | LatLng): string {
	return typeof point === 'string' ? point : `${point.lat},${point.lng}`;
}

/**
 * One call, answered as JSON.
 *
 * @throws {MapsRequestFailed} on any answer but a 2xx.
 */
async function call(
	api: MapsApi,
	url: URL,
	init: RequestInit,
): Promise<unknown> {
	const response = await fetch(url, init);
	const text = await response.text();
	if (!response.ok) {
		throw new MapsRequestFailed(api, response.status, errorDetail(text));
	}
	return text ? JSON.parse(text) : {};
}

/** Google's error, as `STATUS: message`, or the body itself. */
function errorDetail(text: string): string {
	try {
		const body = JSON.parse(text) as {
			error?: { status?: string; message?: string };
			error_message?: string;
			status?: string;
		};
		const error = body.error;
		if (error) {
			return [error.status, error.message].filter(Boolean).join(': ') || text;
		}
		if (body.error_message) {
			return [body.status, body.error_message].filter(Boolean).join(': ');
		}
	} catch {
		// Not JSON: the body says what it says.
	}
	return text || 'no body';
}
