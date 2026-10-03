import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestManifest } from '@geekmidas/constructs/testing';
import { TEST_MANIFEST_ENV as KIT_READS } from '@geekmidas/constructs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	FactoryHasNoCreate,
	TEST_MANIFEST_ENV,
	UnknownFactoryFile,
	writeTestHarness,
} from '../harness';

/**
 * What `gkm test` writes for a feature test to be built from, for a small app
 * declared the way a real one is: a database and the auth server's schema
 * tenant, a Better Auth server with the magic-link plugin, an API that names
 * it, and one endpoint on that API.
 *
 * That the harness then *runs* is proven where it can be — an app driven
 * through `gkm test`, kitchen-sink's suite. This is what it writes.
 */
const fixture = join(import.meta.dirname, '__fixtures__', 'harness-app');

const env = {
	API_URL: 'https://api-test.shop.localhost:28000',
	AUTH_URL: 'https://auth-test.shop.localhost:28000',
	AUTH_SECRET: 'a-signing-secret-that-is-at-least-32-chars',
	DATABASE_URL: 'postgres://database_test:pw@localhost:5432/database_test',
};

describe('writeTestHarness', () => {
	let root: string;
	let apps: string[];

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-harness-'));
		apps = [join(root, 'apps', 'api'), join(root, 'apps', 'web')];
	});

	afterEach(() => rm(root, { recursive: true, force: true }));

	const write = (factories?: string) =>
		writeTestHarness({
			root: fixture,
			targets: apps,
			patterns: [
				'./constructs/**/*.ts',
				'./endpoints/**/*.ts',
				'./subscribers/**/*.ts',
			],
			stage: 'test',
			env,
			cacheBackend: 'db',
			...(factories ? { factories } : {}),
		});

	/** A factories folder holding these files, each exporting `createFactory`. */
	const factoriesWith = async (
		files: Record<string, string> = {},
	): Promise<string> => {
		const folder = join(root, 'test', 'factories');
		await mkdir(folder, { recursive: true });
		for (const [name, content] of Object.entries(files)) {
			await writeFile(join(folder, name), content);
		}
		return folder;
	};
	const FACTORY = 'export function createFactory(db) { return { db }; }\n';

	const read = (app: string, file: string) =>
		readFile(join(app, '.gkm', 'test', file), 'utf-8');

	it('records where every construct and endpoint is exported, and the stage’s env', async () => {
		await write();

		const manifest = JSON.parse(
			await read(apps[0]!, 'manifest.json'),
		) as TestManifest;

		expect(manifest.stage).toBe('test');
		expect(manifest.env).toEqual(env);
		expect(manifest.constructs).toMatchObject({
			Database: {
				kind: 'database',
				source: {
					file: join(fixture, 'constructs', 'database.ts'),
					export: 'database',
				},
			},
			AuthDatabase: {
				kind: 'database-schema',
				source: { export: 'authDatabase' },
			},
			Auth: { kind: 'rest-api', source: { export: 'auth' } },
			Api: { kind: 'rest-api', source: { export: 'api' } },
		});
		expect(manifest.endpoints).toEqual(
			expect.arrayContaining([
				{
					surface: 'Api',
					source: {
						file: join(fixture, 'endpoints', 'health.ts'),
						export: 'health',
					},
				},
				{
					surface: 'Api',
					source: {
						file: join(fixture, 'endpoints', 'notes.ts'),
						export: 'listNotes',
					},
				},
			]),
		);
	});

	it('writes the same harness into every app, so each can map #test to itself', async () => {
		const path = await write();

		expect(path).toBe(join(apps[0]!, '.gkm', 'test', 'manifest.json'));
		for (const app of apps) {
			expect((await readdir(join(app, '.gkm', 'test'))).sort()).toEqual([
				'clients',
				'index.ts',
				'manifest.json',
			]);
		}
		expect(await read(apps[1]!, 'index.ts')).toBe(
			await read(apps[0]!, 'index.ts'),
		);
	});

	it('generates each surface’s typed client with the build’s generator', async () => {
		await write();

		const client = await read(apps[0]!, 'clients/api.ts');

		expect(client).toContain('export function createApi(');
		expect(client).toContain("'/health'");
	});

	it('gives the browser a client per surface, keyed off the construct', async () => {
		await write();

		const harness = await read(apps[0]!, 'index.ts');

		expect(harness).toContain(
			"import { createApi as createApi } from './clients/api.js';",
		);
		expect(harness).toContain('readonly api = createApi({');
		expect(harness).toContain('baseURL: manifest.env["API_URL"]!');
		expect(harness).toContain('fetch: this.fetch');
	});

	it('pairs the auth server’s plugins with better-auth’s client plugins', async () => {
		await write();

		const harness = await read(apps[0]!, 'index.ts');

		// `magic-link` on the server is `magicLinkClient` on the client — the
		// pairing is written down, because the names follow no single rule.
		expect(harness).toContain(
			"import { magicLinkClient } from 'better-auth/client/plugins';",
		);
		expect(harness).toContain('readonly auth = createAuthClient({');
		expect(harness).toContain(
			'baseURL: `${manifest.env["AUTH_URL"]!}/api/auth`',
		);
		expect(harness).toContain('plugins: [magicLinkClient()]');
	});

	it('exports the configured it, built from the manifest beside it', async () => {
		await write();

		const harness = await read(apps[0]!, 'index.ts');

		expect(harness).toContain(
			"const manifest = loadTestManifest(new URL('./manifest.json', import.meta.url));",
		);
		expect(harness).toMatch(
			/export const it = featureTest(<.+>)?\(\{ manifest, modules, browser: Browser \}\);/,
		);
	});

	it('types db by the app’s own databases, keyed by service name', async () => {
		await write();

		const harness = await read(apps[0]!, 'index.ts');

		// Imported as a type from where it is declared, relative to this copy.
		expect(harness).toMatch(
			/import type \{ database as __Database \} from '(\.\.\/)+.*constructs\/database\.js';/,
		);
		expect(harness).toContain(
			'featureTest<Browser, { database: DatabaseOf<typeof __Database> }>({ manifest, modules, browser: Browser })',
		);
		// The auth server's tenant is its own, reached through it.
		expect(harness).not.toContain('__AuthDatabase');
	});

	it('gives the browser a magic-link signIn when the app sends mail', async () => {
		await write();

		const harness = await read(apps[0]!, 'index.ts');

		expect(harness).toContain('signInWithMagicLink } from');
		expect(harness).toContain(
			'return signInWithMagicLink(this, this.auth, email);',
		);
	});

	it('imports every construct, endpoint and subscriber module itself, keyed as the manifest keys it', async () => {
		// From inside the app, where its tsconfig paths resolve: a dynamic import
		// from the kit in node_modules is left to Node, which knows none of them.
		await write();

		const harness = await read(apps[0]!, 'index.ts');
		const manifest = JSON.parse(
			await read(apps[0]!, 'manifest.json'),
		) as TestManifest;
		const files = new Set([
			...Object.values(manifest.constructs).map(({ source }) => source.file),
			...manifest.endpoints.map(({ source }) => source.file),
			...(manifest.subscribers ?? []).map(({ source }) => source.file),
		]);

		// A subscriber is loaded by delivery; one importing `~/…` failed every
		// test file when it was left to Node's own import.
		expect(manifest.subscribers).toEqual([
			{
				source: {
					file: join(fixture, 'subscribers', 'noteEvents.ts'),
					export: 'onNoteCreated',
				},
			},
		]);
		for (const file of files) {
			expect(harness).toContain(`${JSON.stringify(file)}: __module`);
		}
		expect(
			harness.match(/^import \* as __module\d+ from '\.\.\//gm),
		).toHaveLength(files.size);
	});

	it('hands a test each database’s factory, keyed by its service name', async () => {
		const folder = await factoriesWith({ 'database.ts': FACTORY });

		await write(folder);

		const harness = await read(apps[0]!, 'index.ts');
		expect(harness).toContain(
			"import { createFactory as __databaseFactory } from '../../../../test/factories/database.js';",
		);
		expect(harness).toContain(
			'featureTest<Browser, { database: DatabaseOf<typeof __Database> }, { database: typeof __databaseFactory }>' +
				'({ manifest, modules, browser: Browser, factories: { database: __databaseFactory } })',
		);
	});

	it('hands no factories when the folder is empty or missing', async () => {
		await write(join(root, 'test', 'factories'));

		const harness = await read(apps[0]!, 'index.ts');
		expect(harness).not.toContain('factories');
	});

	it('refuses a factory named after no database, rather than never handing it over', async () => {
		const folder = await factoriesWith({ 'users.ts': FACTORY });

		const failure = await write(folder).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(UnknownFactoryFile);
		expect(failure).toMatchObject({ known: ['Database'] });
	});

	it('refuses a factory for the auth server’s tenant, which is reached through it', async () => {
		const folder = await factoriesWith({ 'auth-database.ts': FACTORY });

		await expect(write(folder)).rejects.toBeInstanceOf(UnknownFactoryFile);
	});

	it('refuses a factory that exports no createFactory', async () => {
		const folder = await factoriesWith({
			'database.ts': 'export const factory = {};\n',
		});

		await expect(write(folder)).rejects.toBeInstanceOf(FactoryHasNoCreate);
	});

	it('names the manifest in the variable the kit reads', () => {
		expect(TEST_MANIFEST_ENV).toBe(KIT_READS);
	});

	it('rewrites the harness whole, so a client for a surface that is gone is gone', async () => {
		await write();
		const stale = join(apps[0]!, '.gkm', 'test', 'clients', 'removed.ts');
		await writeFile(stale, '');

		await write();

		expect(await readdir(join(apps[0]!, '.gkm', 'test', 'clients'))).toEqual([
			'api.ts',
		]);
	});
});
