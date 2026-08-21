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
 * What it does not do yet: mount its own routes. That needs the `rest-api`
 * kind, and until it lands the app mounts `auth.handler` itself — see the
 * kitchen-sink server hook.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	environmentCase,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { betterAuth } from 'better-auth';
import type { Kysely } from 'kysely';
import type { Construct, Consumable } from './construct-interface';

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
	 * Declared once and read by both `declare()` and `connect()`, so the key the
	 * target publishes and the key the server reads cannot drift.
	 */
	private readonly secret: { id: string; key: string };

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
		this.secret = { id: secretId, key: environmentCase(secretId) };

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (options) => this.connect(options),
		};
	}

	/**
	 * The signing secret, and nothing else.
	 *
	 * The database is not declared here — it is declared by the tenant that was
	 * passed in, and declaring it twice is the duplication the whole model
	 * removes. The routes are not declared either, because there is no
	 * `rest-api` kind yet to declare them into.
	 */
	declare(): Declaration[] {
		return [
			{ kind: 'secret', id: this.secret.id, provides: [this.secret.key] },
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
		const { secret, baseUrl } = options.envParser
			.create((get) => ({
				secret: get(this.secret.key).string(),
				// The surface's URL, which nothing derives yet — the `rest-api`
				// kind is what will supply it. Until then it follows the port the
				// server was told to listen on.
				baseUrl: get('PORT')
					.string()
					.transform((port) => `http://localhost:${port}`)
					.default('http://localhost:3000'),
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
		});
	}
}
