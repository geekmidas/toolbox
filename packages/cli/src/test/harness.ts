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

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TestStage } from '@geekmidas/constructs';
import type { BetterAuth } from '@geekmidas/constructs/auth';
import type { Endpoint } from '@geekmidas/constructs/endpoints';
import type { TestManifest } from '@geekmidas/constructs/testing';
import { EnvironmentParser } from '@geekmidas/envkit';
import {
	canonicalId,
	kebabCase,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import { serviceContext } from '@geekmidas/services';
import {
	cacheBackendsIn,
	driversFor,
	eventsBackendsIn,
	type RuntimeDrivers,
} from '../generators/drivers.js';
import { EndpointGenerator } from '../generators/EndpointGenerator.js';
import { OpenApiTsGenerator } from '../generators/OpenApiTsGenerator.js';
import { SubscriberGenerator } from '../generators/SubscriberGenerator.js';
import { type ConstructSource, discover } from '../reconcile/discover.js';
import { readFakes } from '../reconcile/fakes.js';
import type { CacheBackend, EventsBackend } from '../types.js';

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
	/** The stage the environment was resolved for: always `test`. */
	stage: TestStage;
	/** The environment the suite runs with. */
	env: Record<string, string>;
	/**
	 * Where a cache lives when it names nowhere — the target's default, which
	 * the build's server entry registers a driver for.
	 */
	cacheBackend: CacheBackend;
	/**
	 * The broker the target puts topics and queues on, which the server entry
	 * registers a driver for when the app declares one.
	 */
	eventsBackend: EventsBackend;
	/**
	 * The folder of test factories, absolute: `test/factories` at the root, or
	 * where `test.factories` in the config points. Absent or empty, a test is
	 * handed no factories.
	 */
	factories?: string;
}

/** Where a project keeps its test factories, relative to its root. */
export const DEFAULT_FACTORIES_DIR = 'test/factories';

/** A file in the factories folder that names no database construct. */
export class UnknownFactoryFile extends Error {
	constructor(
		readonly file: string,
		readonly known: readonly string[],
	) {
		super(
			`${file} names no database construct, so no test could be handed it. ` +
				(known.length > 0
					? `The databases: ${known.join(', ')}. `
					: 'This project declares no database. ') +
				`Name a factory after its database: test/factories/<construct>.ts.`,
		);
		this.name = 'UnknownFactoryFile';
	}
}

/** A factory file that exports no `createFactory`. */
export class FactoryHasNoCreate extends Error {
	constructor(readonly file: string) {
		super(
			`${file} is a test factory but exports no \`createFactory\`. ` +
				`Export \`function createFactory(db: Kysely<Database>)\` returning ` +
				`the factory.`,
		);
		this.name = 'FactoryHasNoCreate';
	}
}

/** One database's factory: the file, and the service name a test keys it by. */
export interface FactorySource {
	file: string;
	service: string;
}

/**
 * The factories in a folder, each matched to the database it is named after.
 *
 * A file that names no database, or exports no `createFactory`, is refused
 * rather than skipped: either is a factory no test would ever be handed.
 */
export async function factorySources(
	folder: string | undefined,
	databases: readonly string[],
): Promise<FactorySource[]> {
	if (!folder) return [];

	const entries = await readdir(folder, { withFileTypes: true }).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		},
	);

	const found: FactorySource[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !isFactoryFile(entry.name)) continue;

		const file = join(folder, entry.name);
		const id = canonicalId(entry.name.slice(0, -extname(entry.name).length));
		if (!databases.includes(id)) {
			throw new UnknownFactoryFile(file, databases);
		}

		const module = (await import(pathToFileURL(file).href)) as {
			createFactory?: unknown;
		};
		if (typeof module.createFactory !== 'function') {
			throw new FactoryHasNoCreate(file);
		}

		found.push({ file, service: serviceKey(id) });
	}

	return found.sort((a, b) => (a.service < b.service ? -1 : 1));
}

function isFactoryFile(file: string): boolean {
	if (file.endsWith('.d.ts')) return false;
	if (/\.(spec|test)\.[cm]?[jt]s$/.test(file)) return false;
	return ['.ts', '.mts', '.js', '.mjs'].includes(extname(file));
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

	// Topic subscribers, which a test delivers to. Not constructs, so the build
	// finds them the way it finds endpoints.
	const subscribers = (
		await new SubscriberGenerator().load(options.patterns, options.root)
	).map(({ key, path }) => ({ source: { file: path.absolute, export: key } }));

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
		subscribers,
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
		events: eventsBackendsIn(declared, options.eventsBackend),
	});

	// The app's own databases: not a tenant an auth server owns — reached
	// through that server — and not a reader of one. What a test is handed.
	const owners = new Set(auths.map((auth) => auth.databaseId));
	const databases = databaseSources(declared, sources).filter(
		({ id, kind }) => !owners.has(id) && kind !== 'database-reader',
	);
	const factories = await factorySources(
		options.factories,
		databases.map(({ id }) => id),
	);
	// Each external API's fake, from the convention rather than the construct —
	// which is what keeps a fake out of every deployed bundle.
	const fakes = Object.entries(await readFakes(options.root, declared)).map(
		([id, { file }]) => ({ id, file }),
	);
	// Every construct a handler can depend on — what a test reaches through
	// `services.get(…)`, typed by the client its service registers. A tenant an
	// auth server owns is reached through that server, as databases are.
	const services = serviceSources(declared, sources).filter(
		({ id }) => !owners.has(id),
	);
	const files = [
		...new Set([
			...Object.values(manifest.constructs).map(({ source }) => source.file),
			...manifest.endpoints.map(({ source }) => source.file),
			// Delivery loads each subscriber too. Left to a dynamic import, it is
			// resolved by Node — which knows nothing of the app's tsconfig paths, so
			// a subscriber importing `~/…` failed every test file that delivered.
			...(manifest.subscribers ?? []).map(({ source }) => source.file),
		]),
	];
	const harnessFor = (dir: string) =>
		harnessModule({
			dir,
			files,
			databases,
			surfaces: surfaces.map((id, index) => ({
				id,
				// The client the generator writes for a surface with authorizers
				// takes a strategy per scheme; one without takes none.
				secured: clients[index]!.content.includes('authStrategies:'),
			})),
			auths,
			drivers,
			factories,
			fakes,
			services,
			mail: Object.values(declared).some(({ kind }) => kind === 'email'),
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
	/** The schema tenant it owns — reached through it, never by a test. */
	databaseId: string;
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
			databaseId: exported.databaseId,
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
/** A database construct: its id, its service name, and where it is exported. */
interface DatabaseSource {
	id: string;
	kind: string;
	service: string;
	source: ConstructSource;
}

/**
 * Every database construct the app declares — a database, a schema tenant, a
 * reader — keyed as a test is handed its transaction.
 */
function databaseSources(
	declared: Awaited<ReturnType<typeof discover>>,
	sources: Record<string, ConstructSource>,
): DatabaseSource[] {
	return Object.entries(declared)
		.filter(([id, declaration]) =>
			Boolean(sources[id] && declaration.kind.startsWith('database')),
		)
		.map(([id, declaration]) => ({
			id,
			kind: declaration.kind,
			service: serviceKey(id),
			source: sources[id]!,
		}));
}

/** The kinds whose construct hands a handler a client — what `services` reaches. */
const SERVICE_KINDS = new Set([
	'cache',
	'credential',
	'database',
	'database-schema',
	'database-reader',
	'email',
	'encryption',
	'external-api',
	'file-server',
	'objects',
	'queue',
	'topic',
]);

function serviceSources(
	declared: Awaited<ReturnType<typeof discover>>,
	sources: Record<string, ConstructSource>,
): DatabaseSource[] {
	return Object.entries(declared)
		.filter(([id, declaration]) =>
			Boolean(sources[id] && SERVICE_KINDS.has(declaration.kind)),
		)
		.map(([id, declaration]) => ({
			id,
			kind: declaration.kind,
			service: serviceKey(id),
			source: sources[id]!,
		}));
}

/** An import specifier for `file`, from the harness written into `dir`. */
function specifierFrom(dir: string, file: string): string {
	const path = relative(dir, file).replace(/\.tsx?$/, '.js');
	return path.startsWith('.') ? path : `./${path}`;
}

function harnessModule(options: {
	dir: string;
	/** Every module the manifest points at, by absolute path. */
	files: string[];
	databases: DatabaseSource[];
	/** Every construct a test reaches through `services`, by service name. */
	services: DatabaseSource[];
	surfaces: { id: string; secured: boolean }[];
	auths: AuthClient[];
	drivers: RuntimeDrivers;
	factories: FactorySource[];
	/** Each external API's fake, by construct id and the file it lives in. */
	fakes: { id: string; file: string }[];
	/** Whether the app sends mail — what a magic-link sign-in is read from. */
	mail: boolean;
}): string {
	const {
		surfaces,
		auths,
		drivers,
		databases,
		services,
		dir,
		files,
		factories,
		fakes,
		mail,
	} = options;
	// One auth server a test can sign in to without a person: a magic link,
	// read from the app's inbox. With two, which one \`signIn\` means is a
	// guess, so neither gets it.
	const magicLinks = mail
		? auths.filter(({ plugins }) => plugins.includes('magicLinkClient'))
		: [];
	const signIn = magicLinks.length === 1 ? magicLinks[0] : undefined;
	const plugins = [...new Set(auths.flatMap(({ plugins }) => plugins))].sort();

	const imports = [
		`import {${services.length ? ' type ClientOf,' : ''}${databases.length ? ' type DatabaseOf,' : ''} featureTest, loadTestManifest${signIn ? ', signInWithMagicLink' : ''} } from '@geekmidas/constructs/testing';`,
		// A type import per construct the types name: each database, and each
		// construct a test reaches through `services` — once, though a database
		// is both.
		...[
			...new Map(
				[...databases, ...services].map((construct) => [
					construct.id,
					construct,
				]),
			).values(),
		].map(
			({ id, source }) =>
				`import type { ${source.exportName} as __${id} } from '${specifierFrom(dir, source.file)}';`,
		),
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
		...factories.map(
			({ file, service }) =>
				`import { createFactory as __${service}Factory } from '${specifierFrom(dir, file)}';`,
		),
		...fakes.map(
			({ id, file }) =>
				`import __${id}Fake from '${specifierFrom(dir, file)}';`,
		),
		// Every construct and endpoint module, imported here — inside the app,
		// where its tsconfig paths resolve — rather than by path from the kit.
		...files.map(
			(file, index) =>
				`import * as __module${index} from '${specifierFrom(dir, file)}';`,
		),
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
		...(signIn
			? [
					`	/**
	 * Sign in as \`email\` through \`${signIn.id}\`'s magic link, the way a person
	 * does — the email opened, the link followed. The session it then reports.
	 * Without an address, as somebody new: \`user.email\` says who.
	 */
	signIn(email?: string) {
		return signInWithMagicLink(this, this.${propertyOf(signIn.id)}, email);
	}`,
				]
			: []),
	];

	// Each database's factory, keyed as the test is handed it.
	const factoriesType = factories.length
		? `{ ${factories.map(({ service }) => `${service}: typeof __${service}Factory`).join('; ')} }`
		: '';
	const factoriesOption = factories.length
		? `, factories: { ${factories.map(({ service }) => `${service}: __${service}Factory`).join(', ')} }`
		: '';
	const fakesOption = fakes.length
		? `, fakes: { ${fakes.map(({ id }) => `${id}: __${id}Fake`).join(', ')} }`
		: '';
	// Each database's schema, keyed as the test is handed its transaction.
	const databasesType = `{ ${databases.map(({ id, service }) => `${service}: DatabaseOf<typeof __${id}>`).join('; ')} }`;
	// Each construct's client, keyed as `services.get(…)` is called.
	const servicesType = services.length
		? `{ ${services.map(({ id, service }) => `${service}: ClientOf<typeof __${id}>`).join('; ')} }`
		: '';
	// Positional, so a later one needs those before it, even when empty.
	const generics =
		databases.length || factoriesType || servicesType
			? `<Browser, ${databases.length ? databasesType : '{}'}${
					factoriesType || servicesType ? `, ${factoriesType || '{}'}` : ''
				}${servicesType ? `, ${servicesType}` : ''}>`
			: '';

	return `// Generated by \`gkm test\` from the app's constructs — do not edit.
${imports.join('\n')}

${drivers.setup ? `// The drivers the app's server entry registers, registered the same way.\n${drivers.setup}\n\n` : ''}const manifest = loadTestManifest(new URL('./manifest.json', import.meta.url));

/** A browser with a client for every surface the app declares. */
export class Browser extends TestBrowser {
${members.join('\n\n')}
}

/** The app's modules, by the path the manifest records for each. */
const modules = {
${files.map((file, index) => `\t${JSON.stringify(file)}: __module${index},`).join('\n')}
};

/** \`it\`, for a test that drives the app the way it runs deployed. */
export const it = featureTest${generics}({ manifest, modules, browser: Browser${factoriesOption}${fakesOption} });
`;
}
