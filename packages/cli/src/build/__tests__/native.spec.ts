import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect } from 'vitest';
import {
	bundleExternals,
	ExternalNotInstalled,
	nativeDependencies,
} from '../native';

async function pkg(
	dir: string,
	manifest: Record<string, unknown>,
	files: Record<string, string> = {},
): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
	for (const [file, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, file)), { recursive: true });
		await writeFile(join(dir, file), content);
	}
}

describe('nativeDependencies', () => {
	itWithDir(
		'finds each way a package says it carries compiled code',
		async ({ dir }) => {
			const app = join(dir, 'apps/api');
			const modules = join(app, 'node_modules');
			await pkg(app, {
				name: 'api',
				dependencies: {
					argon2: '^0.41.0',
					'better-sqlite3': '^11.0.0',
					'@node-rs/bcrypt': '^1.10.0',
					sharp: '^0.33.0',
					prebuilt: '1.0.0',
					addon: '1.0.0',
					hono: '^4.0.0',
				},
			});
			await pkg(join(modules, 'argon2'), {
				name: 'argon2',
				version: '0.41.1',
				dependencies: { 'node-gyp-build': '^4.8.0' },
			});
			await pkg(
				join(modules, 'better-sqlite3'),
				{ name: 'better-sqlite3', version: '11.3.0' },
				{ 'binding.gyp': '{}' },
			);
			await pkg(join(modules, '@node-rs/bcrypt'), {
				name: '@node-rs/bcrypt',
				version: '1.10.4',
				optionalDependencies: {
					'@node-rs/bcrypt-linux-x64-gnu': '1.10.4',
					'@node-rs/bcrypt-darwin-arm64': '1.10.4',
				},
			});
			await pkg(join(modules, 'sharp'), {
				name: 'sharp',
				version: '0.33.5',
				optionalDependencies: { '@img/sharp-linux-x64': '0.33.5' },
			});
			await pkg(
				join(modules, 'prebuilt'),
				{ name: 'prebuilt', version: '1.0.0' },
				{ 'prebuilds/linux-x64/prebuilt.node': '' },
			);
			await pkg(
				join(modules, 'addon'),
				{ name: 'addon', version: '1.0.0' },
				{ 'addon.node': '' },
			);
			await pkg(join(modules, 'hono'), { name: 'hono', version: '4.6.0' });

			expect(nativeDependencies(app)).toEqual({
				'@node-rs/bcrypt': '1.10.4',
				addon: '1.0.0',
				argon2: '0.41.1',
				'better-sqlite3': '11.3.0',
				prebuilt: '1.0.0',
				sharp: '0.33.5',
			});
		},
	);

	itWithDir(
		'follows workspace packages and pnpm’s store to a native package the app does not name',
		async ({ dir }) => {
			const app = join(dir, 'apps/api');
			const auth = join(dir, 'packages/auth');
			const store = join(dir, 'node_modules/.pnpm');
			await pkg(app, {
				name: 'api',
				dependencies: { '@acme/auth': 'workspace:*', 'some-lib': '1.0.0' },
				devDependencies: { 'dev-native': '1.0.0' },
			});
			await pkg(auth, {
				name: '@acme/auth',
				dependencies: { argon2: '^0.41.0' },
			});
			// pnpm: each package in the store, its dependencies beside it.
			const argon2 = join(store, 'argon2@0.41.1/node_modules/argon2');
			await pkg(argon2, {
				name: 'argon2',
				version: '0.41.1',
				dependencies: { 'node-gyp-build': '^4.8.0' },
			});
			const someLib = join(store, 'some-lib@1.0.0/node_modules/some-lib');
			await pkg(someLib, {
				name: 'some-lib',
				version: '1.0.0',
				dependencies: { bindings: '^1.5.0' },
			});
			const devNative = join(store, 'dev-native@1.0.0/node_modules/dev-native');
			await pkg(
				devNative,
				{ name: 'dev-native', version: '1.0.0' },
				{
					'binding.gyp': '{}',
				},
			);

			await mkdir(join(app, 'node_modules/@acme'), { recursive: true });
			await symlink(auth, join(app, 'node_modules/@acme/auth'));
			await symlink(someLib, join(app, 'node_modules/some-lib'));
			await symlink(devNative, join(app, 'node_modules/dev-native'));
			await mkdir(join(auth, 'node_modules'), { recursive: true });
			await symlink(argon2, join(auth, 'node_modules/argon2'));

			// some-lib loads an addon of its own; argon2 comes through @acme/auth;
			// a devDependency is never bundled.
			expect(nativeDependencies(app)).toEqual({
				argon2: '0.41.1',
				'some-lib': '1.0.0',
			});
		},
	);

	itWithDir('finds nothing in an app without any', async ({ dir }) => {
		await pkg(dir, { name: 'api', dependencies: { hono: '^4.0.0' } });
		await pkg(join(dir, 'node_modules/hono'), {
			name: 'hono',
			version: '4.6.0',
		});

		expect(nativeDependencies(dir)).toEqual({});
	});
});

describe('bundleExternals', () => {
	itWithDir(
		'adds a declared package at its installed version',
		async ({ dir }) => {
			await pkg(dir, { name: 'api', dependencies: { pg: '^8.0.0' } });
			await pkg(join(dir, 'node_modules/pg'), {
				name: 'pg',
				version: '8.13.0',
			});

			expect(bundleExternals(dir, ['pg'])).toEqual({ pg: '8.13.0' });
		},
	);

	itWithDir('refuses a declared package nothing installed', async ({ dir }) => {
		await pkg(dir, { name: 'api' });

		expect(() => bundleExternals(dir, ['sharp'])).toThrow(ExternalNotInstalled);
	});
});
