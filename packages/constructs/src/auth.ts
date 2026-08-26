/**
 * `BetterAuth` — a declared auth server.
 *
 * It is three things at once, which is what makes it the construct that
 * exercises most of the model: a consumer of a database, a producer of an
 * authorizer, and a set of endpoints. This lands the first two.
 *
 * Its tables live in a schema tenant it is *given* — `orders.schema('AuthDb')`
 * — rather than one it invents, so the application's own role holds no grant on
 * them and a compromised handler cannot read sessions. The tenant declares the
 * schema and the role; this declares the one thing left, the signing secret,
 * and reads back the two keys it needs.
 *
 * It declares its own surface, so where it answers, who may call it, and the
 * domain its cookies are scoped to all arrive as environment resolved by the
 * target — none of them guessed from a port, and none of them listed by hand in
 * application config.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	environmentCase,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { betterAuth } from 'better-auth';
import type { Kysely } from 'kysely';
import { type Construct, type Consumable, edgeTo } from './construct-interface';

/** The server better-auth hands back. */
export type AuthServer = ReturnType<typeof betterAuth>;

/** Everything better-auth takes, minus what the construct owns. */
export type BetterAuthOptions = Omit<
	Parameters<typeof betterAuth>[0],
	'database' | 'secret' | 'basePath' | 'baseURL'
>;

export interface BetterAuthConfig<TDatabase extends Consumable> {
	/**
	 * The schema tenant its tables live in.
	 *
	 * A construct rather than a URL: the tenant already declares its schema and
	 * its role, and taking the declaration is what puts the edge in the graph
	 * instead of a connection string in two places.
	 */
	database: TDatabase;
	/**
	 * Where the auth routes are mounted, e.g. `/api/auth`.
	 *
	 * Structural — it is part of the URL every client calls, so it cannot differ
	 * between stages the way the host can.
	 */
	basePath?: string;
	/**
	 * The rest of better-auth's options: providers, plugins, email settings.
	 *
	 * A function when they need another construct — a magic-link plugin has to
	 * *send* the link, and the thing that sends mail is a construct whose client
	 * has to be registered. It is handed the same `ServiceRegisterOptions` this
	 * construct was, so the env parser flows through the graph rather than being
	 * imported out of application config.
	 */
	options?:
		| BetterAuthOptions
		| ((
				options: ServiceRegisterOptions,
		  ) => BetterAuthOptions | Promise<BetterAuthOptions>);
}

const DEFAULT_BASE_PATH = '/api/auth';

export class BetterAuth<
	TName extends string = string,
	TDatabase extends Consumable = Consumable,
> implements Construct<TName, AuthServer>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, AuthServer>;
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
		private readonly config: BetterAuthConfig<TDatabase>,
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
			register: (options) => this.connect(options),
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
						dependencies: [edgeTo(this.config.database)],
						requires: [this.keys.secret],
					},
				],
			},
		];
	}

	/**
	 * Better Auth's own migrations, for the app's migrate step.
	 *
	 * It brings its own schema — users, sessions, accounts, verifications — so
	 * the app never writes those tables and never gets to drift from them.
	 */
	async migrations(
		options: ServiceRegisterOptions,
	): Promise<() => Promise<void>> {
		const auth = await this.connect(options);
		const { getMigrations } = await import('better-auth/db');
		const { runMigrations } = await getMigrations(auth.options);

		return runMigrations;
	}

	private async connect(options: ServiceRegisterOptions): Promise<AuthServer> {
		const { secret, baseUrl, trustedOrigins, cookieDomain } = options.envParser
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
			}))
			.parse();

		// The tenant's own client: one construct, one connection, so what auth
		// writes and what the browser inspects cannot be two different databases.
		const db = (await this.config.database.service.register(options)) as Kysely<
			Record<string, never>
		>;

		// Hoisted: narrowing a property of `this` is not preserved across the
		// await, and the false branch is the plain-object form.
		const configure = this.config.options;
		const configured: BetterAuthOptions =
			typeof configure === 'function'
				? await configure(options)
				: (configure ?? {});

		return betterAuth({
			...configured,
			secret,
			baseURL: baseUrl,
			basePath: this.basePath,
			database: { db, type: 'postgres' },
			// Whatever the app added wins over the derived list rather than
			// replacing it: an origin nobody declared is still sometimes real.
			trustedOrigins: [
				...trustedOrigins,
				...(configured.trustedOrigins &&
				Array.isArray(configured.trustedOrigins)
					? configured.trustedOrigins
					: []),
			],
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
		});
	}
}
