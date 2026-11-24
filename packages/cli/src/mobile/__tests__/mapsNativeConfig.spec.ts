import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	ConstructManifest,
	MobileAppDeclaration,
} from '@geekmidas/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	assertMapsInNativeConfig,
	MAPS_EXPO_PLUGIN,
	MapsKeysNotInNativeConfig,
} from '../eas';

/**
 * A mobile app that depends on a `Maps` hands its keys to native config —
 * where react-native-maps reads them — or `gkm eas:sync` refuses to set up a
 * store build whose map would never load.
 */

let dir: string;

beforeEach(async () => {
	dir = await createTempDir('gkm-maps-native-');
});

afterEach(async () => {
	await cleanupDir(dir);
});

const app = (...maps: string[]): MobileAppDeclaration => ({
	kind: 'mobile-app',
	id: 'App',
	variant: 'expo',
	app: { path: 'apps/app' },
	dependencies: [
		{ target: 'Api' },
		...maps.map((target) => ({ target })),
	] as MobileAppDeclaration['dependencies'],
});

const manifest = {
	Api: { kind: 'rest-api', id: 'Api', provides: ['API_URL'] },
	Maps: { kind: 'maps', id: 'Maps', apis: ['maps'], provides: [] },
	Places: { kind: 'maps', id: 'Places', apis: ['maps'], provides: [] },
} as unknown as ConstructManifest;

const config = async (file: string, source: string) => {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, file), source);
};

describe('assertMapsInNativeConfig', () => {
	it('asks nothing of an app that depends on no Maps', async () => {
		await expect(
			assertMapsInNativeConfig(manifest, app(), dir),
		).resolves.toBeUndefined();
	});

	it.for([
		{
			name: 'the plugin',
			file: 'app.config.ts',
			source: `export default { plugins: ['${MAPS_EXPO_PLUGIN}'] };`,
		},
		{
			name: 'withMapsKeys',
			file: 'app.config.js',
			source: 'module.exports = (c) => withMapsKeys(c.config);',
		},
		{
			name: 'the native fields',
			file: 'app.json',
			source:
				'{ "expo": { "android": { "config": { "googleMaps": {} } }, "ios": { "config": { "googleMapsApiKey": "" } } } }',
		},
	])('takes $name as handing the keys over', async ({ file, source }) => {
		await config(file, source);

		await expect(
			assertMapsInNativeConfig(manifest, app('Maps'), dir),
		).resolves.toBeUndefined();
	});

	it('refuses a config that never hands them over, saying what to add', async () => {
		await config(
			'app.config.ts',
			"export default { plugins: ['expo-router'] };",
		);

		const error = await assertMapsInNativeConfig(
			manifest,
			app('Maps'),
			dir,
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(MapsKeysNotInNativeConfig);
		expect((error as Error).message).toContain(
			`plugins: ['${MAPS_EXPO_PLUGIN}']`,
		);
	});

	it('names each construct by id when it is not Maps', async () => {
		const error = await assertMapsInNativeConfig(
			manifest,
			app('Places'),
			dir,
		).catch((e: unknown) => e);

		expect((error as Error).message).toContain(
			`['${MAPS_EXPO_PLUGIN}', { maps: 'Places' }]`,
		);
	});
});
