/**
 * `Maps` — tiles, places, geocoding and routes, called with API keys.
 *
 * ```ts
 * // constructs/maps.ts
 * export const maps = new Maps('Maps', { apis: ['maps', 'places'] });
 *
 * // a server process: its own key, in a handler
 * .dependsOn([maps])
 * .handle(({ services }) => geocode(address, services.maps.apiKey))
 *
 * // a site: VITE_MAPS_BROWSER_KEY, restricted to the stage's sites' hosts
 * new Site('Web', { path: 'apps/web' }).dependsOn([api, maps]);
 *
 * // a mobile app: EXPO_PUBLIC_MAPS_ANDROID_KEY and EXPO_PUBLIC_MAPS_IOS_KEY,
 * // restricted to its package and its bundle id
 * new MobileApp('App', { path: 'apps/app' }).dependsOn([api, maps]);
 * ```
 *
 * **A key per kind of caller, from the graph.** Nobody writes down who holds
 * which key: a server process that depends on it holds `MAPS_API_KEY`, a site
 * `MAPS_BROWSER_KEY`, a mobile app `MAPS_ANDROID_KEY` and `MAPS_IOS_KEY`, and
 * each is restricted to the declared APIs and to what holds it. So the key in
 * a page's JavaScript is useless from a phone or a server, and the server's
 * never reaches a bundle.
 *
 * Deployed, `deploy.maps.<stage> = { provider: 'google' }` has the deploy
 * create the keys and write them into the stage's secrets. Locally, and on a
 * stage that names no provider, they are set by hand.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	MAPS_ROLES,
	type MapsApi,
	providedKeyFor,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import type { Construct } from './construct-interface';

export type { MapsApi } from '@geekmidas/manifest';

/** Every API a `Maps` construct can name. */
export const MAPS_APIS: readonly MapsApi[] = [
	'maps',
	'static-maps',
	'places',
	'geocoding',
	'routes',
];

export interface MapsOptions {
	/**
	 * The APIs the app calls. Every key is restricted to these and nothing
	 * else: `maps` is the map itself, in a page or a phone; `static-maps`,
	 * `places`, `geocoding` and `routes` are the web services.
	 */
	apis: readonly MapsApi[];
}

/** What a server process is handed: its key. */
export interface MapsClient {
	/** The server key: restricted to the declared APIs. */
	apiKey: string;
}

/** A `Maps` that names no API would be given keys that call nothing. */
export class MapsHasNoApis extends Error {
	constructor(readonly maps: string) {
		super(
			`'${maps}' names no API, so its keys would call nothing. Name the ` +
				`ones the app calls: apis: ['maps', 'places'].`,
		);
		this.name = 'MapsHasNoApis';
	}
}

/** An API no `Maps` key can be restricted to. */
export class MapsApiUnknown extends Error {
	constructor(
		readonly maps: string,
		readonly api: string,
	) {
		super(
			`'${maps}' names the API '${api}', which is not one gkm knows. ` +
				`It takes ${MAPS_APIS.map((a) => `'${a}'`).join(', ')}.`,
		);
		this.name = 'MapsApiUnknown';
	}
}

export class Maps<TName extends string = string>
	implements Construct<TName, MapsClient>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, MapsClient>;

	/** The server key: what `connect()` reads and `declare()` publishes. */
	private readonly apiKey: string;

	constructor(
		id: ConstructName<TName>,
		private readonly options: MapsOptions,
	) {
		const canonical = canonicalId(id as string);
		if (options.apis.length === 0) throw new MapsHasNoApis(canonical);
		for (const api of options.apis) {
			if (!MAPS_APIS.includes(api)) throw new MapsApiUnknown(canonical, api);
		}

		this.id = canonical as TName;
		this.apiKey = providedKeyFor(canonical, 'maps', 'apiKey');

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (options) => this.connect(options),
		};
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'maps',
				id: this.id,
				apis: [...new Set(this.options.apis)].sort(),
				provides: MAPS_ROLES.map((role) =>
					providedKeyFor(this.id, 'maps', role),
				),
			},
		];
	}

	private connect(options: ServiceRegisterOptions): MapsClient {
		const { apiKey } = options.envParser
			.create((get) => ({ apiKey: get(this.apiKey).string() }))
			.parse();
		return { apiKey };
	}
}
