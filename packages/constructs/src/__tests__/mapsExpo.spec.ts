import { describe, expect, it } from 'vitest';
import plugin, { mobileMapsKeys, withMapsKeys } from '../maps/expo';

/**
 * The Expo config plugin: a mobile app's Maps keys, from the environment
 * gkm hands it, into the native config react-native-maps reads.
 */

const base = {
	name: 'Shop',
	android: { package: 'com.shop.app', config: { other: true } },
	ios: { bundleIdentifier: 'com.shop.app' },
};

describe('withMapsKeys', () => {
	it('puts each key in its platform’s native config, keeping the rest', () => {
		const config = withMapsKeys(base, {
			env: {
				EXPO_PUBLIC_MAPS_ANDROID_KEY: 'AIza-android',
				EXPO_PUBLIC_MAPS_IOS_KEY: 'AIza-ios',
			},
		});

		expect(config).toEqual({
			name: 'Shop',
			android: {
				package: 'com.shop.app',
				config: { other: true, googleMaps: { apiKey: 'AIza-android' } },
			},
			ios: {
				bundleIdentifier: 'com.shop.app',
				config: { googleMapsApiKey: 'AIza-ios' },
			},
		});
	});

	it('leaves a platform whose key the environment lacks as it was', () => {
		const config = withMapsKeys(base, {
			env: { EXPO_PUBLIC_MAPS_IOS_KEY: 'AIza-ios' },
		});

		expect(config.android).toEqual(base.android);
	});

	it('changes nothing with no keys at all', () => {
		expect(withMapsKeys(base, { env: {} })).toEqual(base);
	});

	it('reads the keys of a construct with another name', () => {
		const config = withMapsKeys(
			{},
			{
				maps: 'Places',
				env: { EXPO_PUBLIC_PLACES_ANDROID_KEY: 'AIza-places' },
			},
		);

		expect(config.android?.config?.googleMaps?.apiKey).toBe('AIza-places');
	});

	it('reads process.env when given no environment', () => {
		process.env.EXPO_PUBLIC_MAPS_IOS_KEY = 'AIza-from-process';
		try {
			expect(plugin({}).ios?.config?.googleMapsApiKey).toBe(
				'AIza-from-process',
			);
		} finally {
			delete process.env.EXPO_PUBLIC_MAPS_IOS_KEY;
		}
	});
});

describe('mobileMapsKeys', () => {
	it('names the keys a mobile app is handed, under EXPO_PUBLIC_', () => {
		expect(mobileMapsKeys()).toEqual({
			android: 'EXPO_PUBLIC_MAPS_ANDROID_KEY',
			ios: 'EXPO_PUBLIC_MAPS_IOS_KEY',
		});
	});
});
