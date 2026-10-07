/**
 * `BetterAuth` — a declared auth server.
 *
 * It is three things at once, which is what makes it the construct that
 * exercises most of the model: a consumer of a database, a producer of an
 * authorizer, and a set of endpoints. This lands the first two.
 *
 * Its tables live in a schema tenant it is *given* — `orders.schema('AuthDb')`
 * — rather than one it invents. The tenant declares the schema and the role;
 * this declares the one thing left, the signing secret, and reads back the keys
 * it needs.
 *
 * :::caution
 * The isolation that arrangement is *for* — the application's own role holding
 * no grant on these tables, so a compromised handler cannot read sessions — does
 * **not hold yet**. No target creates the per-schema role: both connect as the
 * database owner, so today the tenant is a `search_path`, which is a namespace
 * and not a privilege boundary. See "Roles are declared and never created" in
 * `docs/design/constructs-outstanding.md`.
 * :::
 *
 * It declares its own surface, so where it answers, who may call it, and the
 * domain its cookies are scoped to all arrive as environment resolved by the
 * target — none of them guessed from a port, and none of them listed by hand in
 * application config.
 */

import type { EnvironmentParser } from '@geekmidas/envkit';
import {
	type ConstructName,
	canonicalId,
	type Declaration,
	environmentCase,
	isWebOrigin,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type {
	Service,
	ServiceRecord,
	ServiceRegisterOptions,
} from '@geekmidas/services';
// Types only: the server is built in `connect()`, from a dynamic import, so a
// process that only holds the client never loads better-auth to get it.
import type { betterAuth } from 'better-auth';
import type { Hono } from 'hono';
import type { Kysely } from 'kysely';
import {
	type Authenticator,
	type Construct,
	type Consumable,
	edgeTo,
	type ServicesOf,
} from './construct-interface';

/** The server better-auth hands back. */
export type AuthServer = ReturnType<typeof betterAuth>;

/** A signed-in session as better-auth hands it back: `{ user, session }`. */
export type AuthSession = AuthServer['$Infer']['Session'];

/**
 * What `.dependsOn([auth])` hands a handler: the auth server, over HTTP.
 *
 * The server itself — its secret, its tenant's connection, its mailer — lives
 * in the auth app's own process and nowhere else. Every other process is a
 * caller of it, so what it is given is an address and this, with the one
 * call handlers make kept in Better Auth's shape: `api.getSession({ headers })`
 * answers `{ user, session }` or `null`, as the server's own `api` does.
 */
export interface AuthClient {
	readonly api: {
		/**
		 * The session the request's cookie or bearer token belongs to, or `null`
		 * when there is none — asked of `<basePath>/get-session` at the auth
		 * server's URL. Only `cookie`, `authorization` and `x-forwarded-for` are
		 * forwarded.
		 *
		 * @throws {AuthServerUnreachable} when the request does not get there.
		 * @throws {SessionCheckFailed} when the server answers with a failure.
		 */
		getSession(input: {
			headers: ConstructorParameters<typeof Headers>[0];
		}): Promise<AuthSession | null>;
	};
}

/** Everything better-auth takes, minus what the construct owns. */
export type BetterAuthOptions = Omit<
	Parameters<typeof betterAuth>[0],
	'database' | 'secret' | 'basePath' | 'baseURL'
>;

/**
 * What an `options` callback is handed: the options this construct was
 * registered with, and a client for each construct its `dependsOn` names —
 * keyed by service name, exactly as an endpoint's handler receives them.
 */
export type BetterAuthOptionsContext<TUses extends readonly Consumable[]> =
	ServiceRegisterOptions & {
		services: ServiceRecord<[...ServicesOf<TUses>]>;
	};

export interface BetterAuthConfig<
	TDatabase extends Consumable,
	TUses extends readonly Consumable[] = readonly [],
> {
	/**
	 * The schema tenant its tables live in.
	 *
	 * A construct rather than a URL: the tenant already declares its schema and
	 * its role, and taking the declaration is what puts the edge in the graph
	 * instead of a connection string in two places.
	 */
	database: TDatabase;
	/**
	 * The app that serves this auth server, relative to the workspace root —
	 * `'apps/auth'`.
	 *
	 * Required, for the reason `RestApi.path` is. Not to be confused with
	 * `basePath`, which is where its routes are mounted in a URL.
	 */
	path: string;
	/**
	 * The label it answers on under a stage's domain — `api` for
	 * `api.myapp.com`, from `deploy.domains` — and under the project locally,
	 * `api.myapp.localhost`. Absent, its id kebab-cased.
	 */
	subdomain?: string;
	/**
	 * Where the auth routes are mounted, e.g. `/api/auth`.
	 *
	 * Structural — it is part of the URL every client calls, so it cannot differ
	 * between stages the way the host can.
	 */
	basePath?: string;
	/**
	 * The constructs `options` uses — the mailer a magic link goes through,
	 * most often.
	 *
	 * One list, two jobs, the way an endpoint's `.dependsOn()` has: each is an
	 * edge on the server's handler, so whatever is composed from the edges (a
	 * container's environment, a deploy's grants) includes it; and each is
	 * handed to `options` as a client in `services`, so there is no other way
	 * for `options` to reach it — nothing to import and register by hand, and
	 * so nothing that can be used without being declared.
	 */
	dependsOn?: TUses;
	/**
	 * The rest of better-auth's options: providers, plugins, email settings.
	 *
	 * A function when they need another construct — a magic-link plugin has to
	 * *send* the link. It is handed the options this construct was registered
	 * with, and `services`: a client for each construct in `dependsOn`.
	 */
	options?:
		| BetterAuthOptions
		| ((
				context: BetterAuthOptionsContext<TUses>,
		  ) => BetterAuthOptions | Promise<BetterAuthOptions>);
}

const DEFAULT_BASE_PATH = '/api/auth';

export class BetterAuth<
	TName extends string = string,
	TDatabase extends Consumable = Consumable,
	const TUses extends readonly Consumable[] = readonly [],
> implements Construct<TName, AuthClient>, Authenticator<AuthSession>
{
	readonly id: TName;
	/**
	 * What `.dependsOn([auth])` injects: an {@link AuthClient}, never the server.
	 *
	 * Which of the two a process holds is decided by how it reaches the
	 * construct, not by asking where it is running. The auth app's process is
	 * its generated entry, which calls {@link server} and nothing else — a
	 * self-serving surface has no endpoints of its own for a `dependsOn` to sit
	 * on. Every other process reaches it through this. So the API, a worker, a
	 * test's in-process endpoints all get the client, and none of them needs
	 * the signing secret, the auth tenant's URL or the mailer to start.
	 */
	readonly service: Service<Uncapitalize<TName>, AuthClient>;
	readonly basePath: string;

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the keys the
	 * target publishes and the keys the server reads cannot drift.
	 */
	private readonly keys: {
		secretId: string;
		secret: string;
		url: string;
		trustedOrigins: string;
		cookieDomain: string;
	};

	constructor(
		id: ConstructName<TName>,
		private readonly config: BetterAuthConfig<TDatabase, TUses>,
	) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.basePath = config.basePath ?? DEFAULT_BASE_PATH;

		// A secret's name is its key: `Auth` signs with `AUTH_SECRET`, which is
		// also what better-auth's own tooling looks for.
		const secretId = `${canonical}Secret`;
		this.keys = {
			secretId,
			secret: environmentCase(secretId),
			url: provideKey(canonical, 'url'),
			trustedOrigins: provideKey(canonical, 'trustedOrigins'),
			cookieDomain: provideKey(canonical, 'cookieDomain'),
		};

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (options) => this.client(options.envParser),
		};
	}

	/**
	 * A signing secret and a surface.
	 *
	 * The database is *not* declared here — the tenant that was passed in
	 * declares it, and declaring it twice is the duplication the whole model
	 * removes. What is declared is what this construct owns: the key it signs
	 * with, and the routes it answers on.
	 *
	 * One endpoint, wildcarded. Better Auth routes internally and the set of
	 * paths depends on which capabilities are enabled, so enumerating them here
	 * would be a copy of its router that goes stale on its next release. The
	 * surface's job is to send everything under `basePath` to one handler, which
	 * is exactly what the declaration says.
	 */
	declare(): Declaration[] {
		return [
			{
				kind: 'secret',
				id: this.keys.secretId,
				provides: [this.keys.secret],
			},
			{
				kind: 'rest-api',
				id: this.id,
				path: this.config.path,
				...(this.config.subdomain ? { subdomain: this.config.subdomain } : {}),
				provides: [
					this.keys.url,
					this.keys.trustedOrigins,
					this.keys.cookieDomain,
				],
				endpoints: [
					{
						id: `${this.id}Handler`,
						handler: `${this.id}.handler`,
						method: 'ANY',
						path: `${this.basePath}/*`,
						// Read off the tenant rather than written down: this
						// construct takes whatever database it is given, and a
						// hardcoded kind is a second statement of a fact the
						// tenant already makes.
						dependencies: [
							edgeTo(this.config.database),
							...(this.config.dependsOn ?? []).map(edgeTo),
						],
						requires: [this.keys.secret],
					},
				],
			},
		];
	}

	/**
	 * Whose request this is: the session for these headers, or `null`.
	 *
	 * Asked of the auth server over HTTP, at the URL the `.auth()` edge injects —
	 * so it is the same call whether the server runs in this process, beside
	 * it, or behind MSW in a test. The same call {@link AuthClient} makes.
	 */
	async verify(
		headers: Headers,
		envParser: EnvironmentParser<{}>,
	): Promise<AuthSession | null> {
		return this.client(envParser).api.getSession({ headers });
	}

	/**
	 * The client a caller of this server holds: its URL and nothing else.
	 *
	 * `<ID>_URL` is the one key a consumer is given for an edge to a surface —
	 * the compose network's address between containers, the public one where
	 * that is all there is — so this is everything it can know.
	 */
	client(envParser: EnvironmentParser<{}>): AuthClient {
		const { url } = envParser
			.create((get) => ({ url: get(this.keys.url).string() }))
			.parse();
		const endpoint = `${url.replace(/\/$/, '')}${this.basePath}`;

		return {
			api: {
				getSession: ({ headers }) =>
					fetchSession(this.id, endpoint, new Headers(headers)),
			},
		};
	}

	/**
	 * The tenant this server keeps its tables in — whose migrations folder,
	 * `db/<tenant>/`, Better Auth's schema is written into.
	 */
	get databaseId(): string {
		return this.config.database.id;
	}

	/**
	 * The SQL that brings the tenant up to Better Auth's schema, or `undefined`
	 * when it already matches.
	 *
	 * What `gkm migration` writes as the tenant's next migration, so Better
	 * Auth's tables are committed, reviewed and applied like any other — rather
	 * than diffed against the database at runtime, where a change nobody wrote
	 * down happens on whichever machine migrates first.
	 *
	 * Compared as the owner, against the tenant `gkm migrate` has already brought
	 * up to date: what comes back is only what the committed files are missing.
	 */
	async pendingMigration(
		options: ServiceRegisterOptions,
	): Promise<string | undefined> {
		// The options, not a server built from them: better-auth checks its
		// schema when a server starts, and before the migration that creates the
		// tables it can only report them missing.
		const resolved = await this.optionsFor(options, { owner: true });
		const db = (resolved.database as { db: Kysely<Record<string, never>> }).db;

		try {
			// better-auth 1.7 split the migration builder out of `better-auth/db`
			// into its own entry, so importing it no longer drags the whole db
			// layer in behind it.
			const { getMigrations } = await import('better-auth/db/migration');
			const { toBeCreated, toBeAdded, toBeAddedIndexes, compileMigrations } =
				await getMigrations(resolved);

			if (
				toBeCreated.length === 0 &&
				toBeAdded.length === 0 &&
				toBeAddedIndexes.length === 0
			) {
				return undefined;
			}

			return idempotent(await compileMigrations());
		} finally {
			// Its own pool: left open, it keeps the process that asked alive.
			await db.destroy();
		}
	}

	/**
	 * The server this surface runs as, built from its own declaration.
	 *
	 * A surface is a deploy unit, so something has to serve it, and the thing
	 * that knows how is the construct — not a generator writing a mount into
	 * somebody else's entry point. That is how the auth server came to be
	 * mounted by a hook in the application it was supposed to be separate from,
	 * and then to be served by nothing at all when the hook was deleted.
	 *
	 * The routes come from {@link declare}: one wildcard under `basePath`, read
	 * off the same declaration the manifest carries, so the surface the graph
	 * describes and the surface that answers requests cannot disagree.
	 *
	 * ```ts
	 * // .gkm/server/app.ts — the whole generated entry
	 * import { auth } from '@acme/constructs/auth.js';
	 * export const { app } = await auth.server({ envParser });
	 * ```
	 *
	 * The only way to the server: it is what reads the signing secret, opens
	 * the tenant and builds the mailer, so it is built here, in the auth app's
	 * own process, and `.dependsOn([auth])` everywhere else gets
	 * {@link AuthClient}. `auth` is the better-auth instance behind the app.
	 */
	async server(
		options: ServiceRegisterOptions,
	): Promise<{ app: Hono; auth: AuthServer }> {
		const { Hono } = await import('hono');
		const { cors } = await import('hono/cors');
		const app = new Hono();
		const server = await this.connect(options);

		// Who may call this surface, read off the graph. The same list Better
		// Auth checks for CSRF — it arrives as `<ID>_TRUSTED_ORIGINS`, composed
		// by the target from whatever declared an edge to this construct, so a
		// site that depends on the auth server is allowed to reach it and
		// nothing else is. Nobody writes an origin down.
		const { origins } = options.envParser
			.create((get) => ({
				origins: get(this.keys.trustedOrigins)
					.string()
					.default('')
					.transform((value: string) =>
						value
							.split(',')
							.map((origin) => origin.trim())
							.filter(Boolean),
					),
			}))
			.parse();

		app.use('*', cors({ origin: origins, credentials: true, maxAge: 3600 }));

		// Read off the declaration rather than restated here. `ANY` is every
		// method Better Auth routes internally, which is the reason the
		// declaration wildcards rather than enumerating.
		const [surface] = this.declare().filter(
			(d): d is Extract<Declaration, { kind: 'rest-api' }> =>
				d.kind === 'rest-api',
		);

		for (const endpoint of surface?.endpoints ?? []) {
			const methods =
				endpoint.method === 'ANY'
					? (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)
					: ([endpoint.method] as const);

			app.on([...methods], endpoint.path, (c) => server.handler(c.req.raw));
		}

		return { app, auth: server };
	}

	/**
	 * The ids of the better-auth plugins this server runs — what a client has
	 * to pair its own plugins with (`magic-link` with `magicLinkClient`).
	 * Resolved the way the server resolves them, options callback included.
	 */
	async pluginIds(options: ServiceRegisterOptions): Promise<string[]> {
		const { plugins = [] } = await this.configured(options);
		return plugins.map(({ id }) => id);
	}

	/** Better-auth's options as given — a value, or a callback of the environment. */
	private async configured(
		options: ServiceRegisterOptions,
	): Promise<BetterAuthOptions> {
		// Hoisted: narrowing a property of `this` is not preserved across the
		// await, and the false branch is the plain-object form.
		const configure = this.config.options;
		if (typeof configure !== 'function') return configure ?? {};

		// A client for each declared construct, from the options this call was
		// given — not the process-wide discovery, which keeps whichever env
		// parser reached it first.
		const services: Record<string, unknown> = {};
		for (const construct of this.config.dependsOn ?? []) {
			services[construct.service.serviceName] =
				await construct.service.register(options);
		}

		return configure({
			...options,
			services,
		} as BetterAuthOptionsContext<TUses>);
	}

	private async connect(
		options: ServiceRegisterOptions,
		as: { owner?: boolean } = {},
	): Promise<AuthServer> {
		const { betterAuth } = await import('better-auth');
		// `Auth<O>` is invariant in its options in better-auth 1.7, so the value
		// built from a concrete literal is not assignable to the `AuthServer`
		// alias, which names the constraint. The runtime object is the same one
		// either way; the assertion keeps the variance where it happens instead
		// of spreading a generic through the construct's public type.
		return betterAuth(await this.optionsFor(options, as)) as AuthServer;
	}

	/**
	 * Everything better-auth is given: the app's options, and what the construct
	 * owns — its secret, its URL, its tenant's connection, the origins and cookie
	 * domain its graph derives. One place, so the server and its migrations are
	 * built from the same options.
	 */
	private async optionsFor(
		options: ServiceRegisterOptions,
		as: { owner?: boolean } = {},
	): Promise<Parameters<typeof betterAuth>[0]> {
		const { secret, baseUrl, trustedOrigins, cookieDomain, deviceUrl } =
			options.envParser
				.create((get) => ({
					secret: get(this.keys.secret).string(),
					// The surface's own URL, resolved by the target — not guessed from
					// a port, which was wrong the moment the server moved to 3001.
					baseUrl: get(this.keys.url).string(),
					// Better Auth's CSRF check applies to every caller, not just
					// browsers, so an API calling the auth server is rejected unless
					// its origin is trusted. The list is derived from the graph and
					// arrives as one comma-separated value, for the same reason every
					// other derived value arrives as a string: it crosses a process
					// boundary as env.
					trustedOrigins: get(this.keys.trustedOrigins)
						.string()
						.default('')
						.transform((value) =>
							value
								.split(',')
								.map((origin) => origin.trim())
								.filter(Boolean),
						),
					// The domain a session cookie has to carry to be readable by a
					// frontend on a sibling host. Optional because there is often
					// nothing to widen to: locally everything shares `localhost`,
					// where cookies ignore the port and a `Domain` would only be a
					// value the browser refuses.
					cookieDomain: get(this.keys.cookieDomain).string().optional(),
					// Where a phone reaches this server, on a local stage with a mobile
					// app: its own port on the LAN address. Never deployed.
					deviceUrl: get(provideKey(this.id, 'deviceUrl')).string().optional(),
				}))
				.parse();

		// The tenant's own client: one construct, one connection, so what auth
		// writes and what the browser inspects cannot be two different databases.
		// A migration asks the tenant for its owner connection, which the tenant
		// exposes as a `Service` and not as anything `.dependsOn()` would take.
		const tenant = this.config.database as Consumable & {
			owner?: Service<string, unknown>;
		};
		const source = as.owner && tenant.owner ? tenant.owner : tenant.service;

		const db = (await source.register(options)) as Kysely<
			Record<string, never>
		>;

		const configured = await this.configured(options);

		// Whatever the app added wins over the derived list rather than
		// replacing it: an origin nobody declared is still sometimes real.
		const origins = [
			...trustedOrigins,
			...(configured.trustedOrigins && Array.isArray(configured.trustedOrigins)
				? configured.trustedOrigins
				: []),
		];

		const plugins = [...(configured.plugins ?? [])];
		// A mobile app depends on this server: the graph put its scheme among
		// the derived origins. It signs in through Better Auth's Expo plugin —
		// the app sends its scheme as the origin, and the plugin is what reads
		// it — so a server without it would refuse every request the app made.
		// Asked of the app rather than imported here: a package this one
		// imported would have to be its peer, and an optional peer gives every
		// differently-resolving workspace package its own copy of this one.
		const mobile = trustedOrigins.filter((origin) => !isWebOrigin(origin));
		if (mobile.length > 0 && !plugins.some((plugin) => plugin.id === 'expo')) {
			throw new ExpoPluginRequired(this.id, mobile);
		}
		// A sign-in link the app asked for is opened on the phone, which cannot
		// resolve this server's local hostname; on a local stage it is built on
		// the address the phone reaches it on instead.
		if (deviceUrl) {
			for (const plugin of plugins) reachableFromDevice(plugin, deviceUrl);
		}

		return {
			...configured,
			secret,
			baseURL: baseUrl,
			basePath: this.basePath,
			database: { db, type: 'postgres' },
			plugins,
			trustedOrigins: origins,
			advanced: {
				...configured.advanced,
				// Only when a domain was derived. Better Auth reads the presence
				// of this block as intent, so enabling it with no domain would
				// widen the cookie to whatever host happened to set it — and the
				// case with nothing to widen to is the common one, not an error.
				...(cookieDomain
					? {
							crossSubDomainCookies: {
								enabled: true,
								domain: cookieDomain,
								...configured.advanced?.crossSubDomainCookies,
							},
						}
					: {}),
			},
		};
	}
}

/** Links already rewritten — an `options` object is reused across builds. */
const rewritten = new WeakSet<object>();

/**
 * Build the magic links an app asked for on the address a phone reaches.
 *
 * An app's link carries its scheme as the `callbackURL` (`shop://…`)
 * where a browser's carries a path or an `http(s)` URL — which is how the two
 * are told apart. A browser's link is left alone: it is opened on this
 * machine, where the server's own hostname resolves.
 *
 * Better Auth's magic-link plugin calls `sendMagicLink` through the options
 * object it returns, so wrapping it there is wrapping the call.
 */
function reachableFromDevice(plugin: { id: string }, deviceUrl: string): void {
	if (plugin.id !== 'magic-link') return;
	const options = (plugin as { options?: MagicLinkOptions }).options;
	if (!options?.sendMagicLink || rewritten.has(options)) return;
	rewritten.add(options);

	const send = options.sendMagicLink;
	options.sendMagicLink = (data, ...rest) =>
		send({ ...data, url: deviceLink(data.url, deviceUrl) }, ...rest);
}

interface MagicLinkOptions {
	sendMagicLink?: (
		data: { email: string; url: string; token: string },
		...rest: unknown[]
	) => unknown;
}

/** A magic link moved to the device address when an app is its destination. */
export function deviceLink(url: string, deviceUrl: string): string {
	try {
		const link = new URL(url);
		const callback = link.searchParams.get('callbackURL') ?? '/';
		if (callback.startsWith('/') || isWebOrigin(callback)) return url;
		return new URL(`${link.pathname}${link.search}`, deviceUrl).toString();
	} catch {
		return url;
	}
}

/** A mobile app depends on this auth server, which has no Expo plugin. */
export class ExpoPluginRequired extends Error {
	constructor(
		readonly server: string,
		/** The schemes the graph says call it — what made the plugin necessary. */
		readonly origins: readonly string[],
	) {
		super(
			`'${server}' is called by a mobile app (${origins[0]}), and a mobile app ` +
				`signs in through Better Auth's Expo plugin: add expo() from ` +
				`'@better-auth/expo' to this auth server's plugins.`,
		);
		this.name = 'ExpoPluginRequired';
	}
}

/**
 * What is forwarded to the auth server: the headers a session travels in, and
 * whose request it is — the server rate-limits `/get-session` by the client's
 * address, so without it every caller shares the API's one bucket.
 */
const SESSION_HEADERS = ['cookie', 'authorization', 'x-forwarded-for'] as const;

/** `GET <basePath>/get-session`, read the way Better Auth answers it. */
async function fetchSession(
	authenticator: string,
	endpoint: string,
	given: Headers,
): Promise<AuthSession | null> {
	const headers = new Headers();
	for (const name of SESSION_HEADERS) {
		const value = given.get(name);
		if (value) headers.set(name, value);
	}

	const url = `${endpoint}/get-session`;
	let response: Response;
	try {
		response = await fetch(url, { headers });
	} catch (cause) {
		throw new AuthServerUnreachable(authenticator, url, cause);
	}

	// Better Auth answers `null` for a request with no session, and a 401 is
	// the same answer from anything in front of it. Anything else that is not
	// a 200 is the server failing, which is not "signed out" and must not be
	// read as it.
	if (response.status === 401) return null;
	if (!response.ok) {
		throw new SessionCheckFailed(authenticator, response.status);
	}

	return (await response.json()) as AuthSession | null;
}

/** The auth server answered a session check with a failure. */
export class SessionCheckFailed extends Error {
	constructor(
		readonly authenticator: string,
		readonly status: number,
	) {
		super(
			`'${authenticator}' answered a session check with ${status}. ` +
				`A request with no session gets 200 and null, or 401; this is the ` +
				`server failing — check its logs, and that it is running at its URL.`,
		);
		this.name = 'SessionCheckFailed';
	}
}

/** A session check never reached the auth server. */
export class AuthServerUnreachable extends Error {
	constructor(
		readonly authenticator: string,
		readonly url: string,
		cause: unknown,
	) {
		super(
			`'${authenticator}' could not be reached at ${url} to check a session. ` +
				`Check that the auth app is running and that this app's ` +
				`${provideKey(authenticator, 'url')} points at it.`,
			{ cause },
		);
		this.name = 'AuthServerUnreachable';
	}
}

/**
 * Better Auth's DDL, safe to run where its tables already exist.
 *
 * Its SQL is Kysely's, so its shape is known: `create table "…"`, `create index
 * "…"`, `alter table "…" add column "…"`. A database that has been running
 * already has those — Better Auth used to create them at runtime — and the
 * first committed migration would fail on them rather than recording that they
 * are there.
 */
export function idempotent(statements: string): string {
	return statements
		.replace(/\bcreate table "/gi, 'create table if not exists "')
		.replace(
			/\bcreate (unique )?index "/gi,
			(_, unique = '') => `create ${unique}index if not exists "`,
		)
		.replace(/\badd column "/gi, 'add column if not exists "');
}
