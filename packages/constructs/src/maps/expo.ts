/**
 * The Expo config plugin that puts a `Maps` construct's mobile keys where
 * `react-native-maps` reads them: in the native config, not in JavaScript.
 *
 * A mobile app that depends on a `Maps` is handed `EXPO_PUBLIC_MAPS_ANDROID_KEY`
 * and `EXPO_PUBLIC_MAPS_IOS_KEY` — locally by `gkm exec`, on EAS from the
 * stage's environment `gkm eas:sync` writes. The map's SDK never reads them
 * from there: Android takes its key from the manifest, iOS from the app's
 * plist, both built from `app.config.ts`. One line hands them over:
 *
 * ```ts
 * // apps/app/app.config.ts
 * plugins: ['@geekmidas/constructs/maps/expo'],
 * // or, for a construct not named Maps:
 * plugins: [['@geekmidas/constructs/maps/expo', { maps: 'Places' }]],
 * ```
 */

import { providedKeyFor } from '@geekmidas/manifest';

/** What the plugin reads and writes of an Expo config. */
export interface ExpoMapsConfig {
	android?: {
		config?: { googleMaps?: { apiKey?: string } } & Record<string, unknown>;
	} & Record<string, unknown>;
	ios?: {
		config?: { googleMapsApiKey?: string } & Record<string, unknown>;
	} & Record<string, unknown>;
	[field: string]: unknown;
}

export interface WithMapsKeysOptions {
	/** The `Maps` construct's id. Defaults to `Maps`. */
	maps?: string;
	/** Where the keys are read from. Defaults to `process.env`. */
	env?: Readonly<Record<string, string | undefined>>;
}

/** The environment variables a mobile app is handed `maps`'s keys under. */
export function mobileMapsKeys(maps = 'Maps'): {
	android: string;
	ios: string;
} {
	return {
		android: `EXPO_PUBLIC_${providedKeyFor(maps, 'maps', 'androidKey')}`,
		ios: `EXPO_PUBLIC_${providedKeyFor(maps, 'maps', 'iosKey')}`,
	};
}

/**
 * `config`, with each platform's Maps key in its native config — for the
 * keys the environment holds. A platform whose key is not there is left as
 * it was.
 */
export function withMapsKeys<T extends ExpoMapsConfig>(
	config: T,
	options: WithMapsKeysOptions = {},
): T {
	const env = options.env ?? process.env;
	const names = mobileMapsKeys(options.maps);
	const android = env[names.android];
	const ios = env[names.ios];
	return {
		...config,
		...(android
			? {
					android: {
						...config.android,
						config: {
							...config.android?.config,
							googleMaps: {
								...config.android?.config?.googleMaps,
								apiKey: android,
							},
						},
					},
				}
			: {}),
		...(ios
			? {
					ios: {
						...config.ios,
						config: { ...config.ios?.config, googleMapsApiKey: ios },
					},
				}
			: {}),
	};
}

export default withMapsKeys;
