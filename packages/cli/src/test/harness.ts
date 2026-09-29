/**
 * What `gkm test` writes for a feature test to be built from.
 *
 * `gkm test` already discovers an app's constructs and resolves the test
 * stage's environment; this keeps both, under `.gkm/test/`:
 *
 * - `manifest.json` — which construct and endpoint is exported where, and the
 *   environment the test stage resolved, keyed as the constructs derive keys.
 * - `clients/<surface>.ts` — each surface's typed client, from the same
 *   generator `gkm build` uses for the app's own.
 * - `index.ts` — the configured `it`, and a `Browser` holding one client per
 *   surface and one per auth server, each on the browser's `fetch`.
 *
 * A test imports `it` from there and declares nothing — not a construct, not an
 * environment key, not a client.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { BetterAuth } from '@geekmidas/constructs/auth';
import type { Endpoint } from '@geekmidas/constructs/endpoints';
import type { TestManifest } from '@geekmidas/constructs/testing';
import { EnvironmentParser } from '@geekmidas/envkit';
import { kebabCase, provideKey } from '@geekmidas/manifest';
import { serviceContext } from '@geekmidas/services';
import {
	cacheBackendsIn,
	driversFor,
	type RuntimeDrivers,
} from '../generators/drivers.js';
import { EndpointGenerator } from '../generators/EndpointGenerator.js';
import { OpenApiTsGenerator } from '../generators/OpenApiTsGenerator.js';
import { type ConstructSource, discover } from '../reconcile/discover.js';
import type { CacheBackend } from '../types.js';

/**
 * The variable the manifest's path travels in — what
 * `@geekmidas/constructs/testing` reads. Its own constant rather than an import:
 * that entry carries the whole harness (MSW, Hono, Vitest), and importing it
 * here put all of it on the start-up path of every `gkm` command.
 */
export const TEST_MANIFEST_ENV = 'GKM_TEST_MANIFEST';

/** Where the harness lives, relative to the workspace root. */
export const TEST_HARNESS_DIR = '.gkm/test';

/**
 * Better-auth's client plugin for each server plugin id.
 *
 * Written down rather than derived: the ids and the client names do not follow
 * one rule (`admin` pairs with `adminClient`, `email-otp` with
 * `emailOTPClient`), and a guess that missed would hand a test a client
 * silently lacking every method of that plugin. A server plugin not listed has
 * no client counterpart — `bearer`, `open-api` — or needs one from another
 * package, and is left out.
 */
const CLIENT_PLUGINS: Readonly<Record<string, string>> = {
	admin: 'adminClient',
	anonymous: 'anonymousClient',
	'device-authorization': 'deviceAuthorizationClient',
	'email-otp': 'emailOTPClient',
	jwt: 'jwtClient',
	'last-login-method': 'lastLoginMethodClient',
	'magic-link': 'magicLinkClient',
	'multi-session': 'multiSessionClient',
	'oauth-popup': 'oauthPopupClient',
	'one-tap': 'oneTapClient',
	'one-time-token': 'oneTimeTokenClient',
	organization: 'organizationClient',
	'phone-number': 'phoneNumberClient',
	siwe: 'siweClient',
	'two-factor': 'twoFactorClient',
	username: 'usernameClient',
};

export interface WriteTestHarnessOptions {
	/** The workspace root: where discovery runs from. */
	root: string;
	/**
	 * The directories to write `.gkm/test/` into — each app's own. A package
	 * maps its `#test` import only to a path inside itself, so each app gets its
	 * own copy of the harness rather than one at the root it cannot reach.
	 */
	targets: string[];
	/** The constructs glob — the same patterns reconcile and the build use. */
	patterns: string[];
	/** The stage the environment was resolved for. */
	stage: string;
	/** The environment the suite runs with. */
	env: Record<string, string>;
	/**
	 * Where a cache lives when it names nowhere — the target's default, which
	 * the build's server entry registers a driver for.
	 */
	cacheBackend: CacheBackend;
}

/** Write the manifest, the clients and the harness; return the manifest path. */
export async function writeTestHarness(
	options: WriteTestHarnessOptions,
): Promise<string> {
	const sources: Record<string, ConstructSource> = {};
	const declared = await discover({
		patterns: options.patterns,
		cwd: options.root,
		sources,
	});

	const loaded = await new EndpointGenerator().load(
		options.patterns,
		options.root,
	);
	const endpoints = loaded
		.map(({ key, construct, path }) => ({
			surface: construct.owner ?? construct.surface?.id,
			construct,
			source: { file: path.absolute, export: key },
		}))
		.filter(
			(endpoint): endpoint is typeof endpoint & { surface: string } =>
				endpoint.surface !== undefined,
		);

	const manifest: TestManifest = {
		stage: options.stage,
		constructs: Object.fromEntries(
			Object.entries(declared).flatMap(([id, declaration]) => {
				const source = sources[id];
				return source
					? [
							[
								id,
								{
									kind: declaration.kind,
									source: { file: source.file, export: source.exportName },
								},
							],
						]
					: [];
			}),
		),
		endpoints: endpoints.map(({ surface, source }) => ({ surface, source })),
		env: options.env,
	};
	// One typed client per surface, from the generator the build uses.
	const surfaces = [...new Set(endpoints.map(({ surface }) => surface))];
	const generator = new OpenApiTsGenerator();
	const clients = await Promise.all(
		surfaces.map(async (surface) => ({
			file: `${kebabCase(surface)}.ts`,
			content: await generator.generate(
				endpoints
					.filter((endpoint) => endpoint.surface === surface)
					.map(({ construct }) => construct as Endpoint<any, any, any, any>),
				{ title: surface, version: '1.0.0' },
			),
		})),
	);

	const auths = await authClients(declared, sources, options.env);
	// The drivers the server entry registers — which cache and storage clients
	// exist is the entry's decision, and the harness stands where the entry does.
	const drivers = driversFor({
		appRoot: options.root,
		cache: cacheBackendsIn(declared, options.cacheBackend),
	});
	const database = await databaseSource(
		declared,
		sources,
		endpoints.map(({ construct }) => construct as Endpoint<any, any, any, any>),
	);
	const harnessFor = (dir: string) =>
		harnessModule({
			dir,
			database,
			surfaces: surfaces.map((id, index) => ({
				id,
				// The client the generator writes for a surface with authorizers
				// takes a strategy per scheme; one without takes none.
				secured: clients[index]!.content.includes('authStrategies:'),
			})),
			auths,
			drivers,
		});
	const json = `${JSON.stringify(manifest, null, 2)}\n`;

	const written = await Promise.all(
		[...new Set(options.targets)].map(async (target) => {
			const dir = join(target, TEST_HARNESS_DIR);
			// Rewritten whole on every run: a client for a surface that no longer
			// exists is not something a test should be able to import.
			await rm(dir, { recursive: true, force: true });
			await mkdir(join(dir, 'clients'), { recursive: true });
			await writeFile(join(dir, 'manifest.json'), json);
			await writeFile(join(dir, 'index.ts'), harnessFor(dir));
			for (const client of clients) {
				await writeFile(join(dir, 'clients', client.file), client.content);
			}
			return join(dir, 'manifest.json');
		}),
	);

	return written[0]!;
}

interface AuthClient {
	id: string;
	basePath: string;
	plugins: string[];
}

/** Each auth server, with the client plugins its server plugins pair with. */
async function authClients(
	declared: Awaited<ReturnType<typeof discover>>,
	sources: Record<string, ConstructSource>,
	env: Record<string, string>,
): Promise<AuthClient[]> {
	const clients: AuthClient[] = [];
	const envParser = new EnvironmentParser({ ...env });

	for (const [id, declaration] of Object.entries(declared)) {
		const source = sources[id];
		if (declaration.kind !== 'rest-api' || !source) continue;

		const exported = (await import(source.file))[source.exportName] as unknown;
		if (!isBetterAuth(exported) || exported.id !== id) continue;

		const ids = await exported.pluginIds({
			envParser,
			context: serviceContext,
		});
		clients.push({
			id,
			basePath: exported.basePath,
			plugins: ids.flatMap((plugin) => CLIENT_PLUGINS[plugin] ?? []),
		});
	}

	return clients;
}

function isBetterAuth(value: unknown): value is BetterAuth {
	return (
		typeof value === 'object' &&
		value !== null &&
		'pluginIds' in value &&
		'basePath' in value
	);
}

/** `Api` → `api`, `AdminApi` → `adminApi`: a construct id as a property name. */
function propertyOf(id: string): string {
	return id.charAt(0).toLowerCase() + id.slice(1);
}

/**
 * The database a test's `db` is — the one the endpoints were given with
 * `.database()`, found by the service they hold, which is the construct's own.
 * The same rule `featureTest` applies at runtime, applied here so `db` can be
 * typed by the construct's schema.
 */
async function databaseSource(
	declared: Awaited<ReturnType<typeof discover>>,
	sources: Record<string, ConstructSource>,
	endpoints: Endpoint<any, any, any, any>[],
): Promise<ConstructSource | undefined> {
	const services = new Set<unknown>(
		endpoints.map((endpoint) => endpoint.databaseService).filter(Boolean),
	);
	if (services.size === 0) return undefined;

	for (const [id, declaration] of Object.entries(declared)) {
		const source = sources[id];
		if (!source || !declaration.kind.startsWith('database')) continue;

		const exported = (await import(source.file))[source.exportName] as {
			service?: unknown;
		};
		if (services.has(exported?.service)) return source;
	}
	return undefined;
}

/** An import specifier for `file`, from the harness written into `dir`. */
function specifierFrom(dir: string, file: string): string {
	const path = relative(dir, file).replace(/\.tsx?$/, '.js');
	return path.startsWith('.') ? path : `./${path}`;
}

function harnessModule(options: {
	dir: string;
	database: ConstructSource | undefined;
	surfaces: { id: string; secured: boolean }[];
	auths: AuthClient[];
	drivers: RuntimeDrivers;
}): string {
	const { surfaces, auths, drivers, database, dir } = options;
	const plugins = [...new Set(auths.flatMap(({ plugins }) => plugins))].sort();

	const imports = [
		`import {${database ? ' type DatabaseOf,' : ''} featureTest, loadTestManifest } from '@geekmidas/constructs/testing';`,
		...(database
			? [
					`import type { ${database.exportName} as __database } from '${specifierFrom(dir, database.file)}';`,
				]
			: []),
		`import { Browser as TestBrowser } from '@geekmidas/testkit/browser';`,
		...surfaces.map(
			({ id }) =>
				`import { createApi as create${id} } from './clients/${kebabCase(id)}.js';`,
		),
		...(auths.length
			? [`import { createAuthClient } from 'better-auth/client';`]
			: []),
		...(plugins.length
			? [`import { ${plugins.join(', ')} } from 'better-auth/client/plugins';`]
			: []),
		...(drivers.imports ? [drivers.imports] : []),
	];

	const url = (id: string) =>
		`manifest.env[${JSON.stringify(provideKey(id, 'url'))}]!`;

	const members = [
		...surfaces.map(
			({ id, secured }) => `	/** \`${id}\`, at ${provideKey(id, 'url')}. */
	readonly ${propertyOf(id)} = create${id}({
		baseURL: ${url(id)},
		fetch: this.fetch,${
			secured
				? `
		// Served in-process: no authorizer runs, so nothing is signed. A scheme
		// with no strategy sends its request without credentials.
		authStrategies: {} as never,`
				: ''
		}
	});`,
		),
		...auths.map(
			(auth) => `	/** \`${auth.id}\`, at ${provideKey(auth.id, 'url')}. */
	readonly ${propertyOf(auth.id)} = createAuthClient({
		baseURL: \`\${${url(auth.id)}}${auth.basePath}\`,
		plugins: [${auth.plugins.map((plugin) => `${plugin}()`).join(', ')}],
		fetchOptions: { customFetchImpl: this.fetch },
	});`,
		),
	];

	return `// Generated by \`gkm test\` from the app's constructs — do not edit.
${imports.join('\n')}

${drivers.setup ? `// The drivers the app's server entry registers, registered the same way.\n${drivers.setup}\n\n` : ''}const manifest = loadTestManifest(new URL('./manifest.json', import.meta.url));

/** A browser with a client for every surface the app declares. */
export class Browser extends TestBrowser {
${members.join('\n\n')}
}

/** \`it\`, for a test that drives the app the way it runs deployed. */
export const it = featureTest${database ? '<Browser, DatabaseOf<typeof __database>>' : ''}({ manifest, browser: Browser });
`;
}
