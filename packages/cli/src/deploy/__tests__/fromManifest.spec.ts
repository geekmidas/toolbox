import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import type { DokployApi } from '../dokploy-api';
import {
	CacheIsAmbiguous,
	CacheNeedsAHome,
	type DokployProvisionContext,
	type Provisioned,
	provisionerFor,
	SurfaceHasNoAddress,
	serviceName,
	UnresolvedParent,
} from '../fromManifest';

/**
 * The Dokploy target's decisions, asserted without a Dokploy.
 *
 * That is the shape being tested as much as the answers are: each entry takes a
 * declaration and a context and returns what it resolved, so the only thing a
 * suite has to stand in for is the REST wrapper. It is also what would let a
 * Pulumi dynamic provider wrap one later without the table changing.
 */
const manifest = {
	Orders: {
		kind: 'database',
		id: 'Orders',
		engine: 'postgres',
		schema: 'app',
		provides: ['ORDERS_URL'],
	},
	AuthDb: {
		kind: 'database-schema',
		id: 'AuthDb',
		of: 'Orders',
		schema: 'authdb',
		provides: ['AUTH_DB_URL'],
	},
	OrdersReader: {
		kind: 'database-reader',
		id: 'OrdersReader',
		of: 'Orders',
		provides: ['ORDERS_READER_URL'],
	},
	Sessions: { kind: 'cache', id: 'Sessions', provides: ['SESSIONS_URL'] },
	Api: {
		kind: 'rest-api',
		id: 'Api',
		endpoints: [],
		provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
	},
	AuthSecret: {
		kind: 'secret',
		id: 'AuthSecret',
		provides: ['AUTH_SECRET'],
	},
} as const satisfies ConstructManifest;

/** A Dokploy that creates nothing and remembers what it was asked for. */
function fakeApi() {
	const created: string[] = [];

	const api = {
		async findOrCreatePostgres(
			name: string,
			_projectId: string,
			_environmentId: string,
			options?: { databaseName?: string },
		) {
			created.push(name);

			// Faithful about the distinction the real API draws: `name` is the
			// Dokploy service, `databaseName` is what Postgres calls the database.
			// A fake that echoed the service name back hid the two being conflated.
			const databaseName = options?.databaseName ?? name;

			return {
				postgres: {
					postgresId: `pg-${name}`,
					// The service's own name on the Docker network, which is what an
					// app connects to — never the server's public address.
					appName: `${name}-service`,
					databaseName,
					databaseUser: `${databaseName}_master`,
					databasePassword: 'master-password',
				},
				created: true,
			};
		},
	} as unknown as DokployApi;

	return { api, created };
}

async function provision(
	overrides: Partial<DokployProvisionContext> = {},
	source: ConstructManifest = manifest,
): Promise<{ context: DokployProvisionContext; env: Record<string, string> }> {
	const { api } = fakeApi();
	const context: DokployProvisionContext = {
		manifest: source,
		provisioned: {} as Record<string, Provisioned>,
		api,
		projectId: 'project',
		environmentId: 'environment',
		stage: 'production',
		project: 'shop',
		cache: 'db',
		addresses: { Api: 'https://api.example.com' },
		deferred: [],
		clusters: {},
		...overrides,
	};

	const env: Record<string, string> = {};

	// Parents first, which is what `provisionOrder` is for — a derived construct
	// reads its parent's resolved URL and there is nothing to read otherwise.
	for (const id of provisionOrder(source)) {
		const declaration = source[id];
		const provisioner = declaration && provisionerFor(declaration.kind);
		if (!declaration || !provisioner) continue;

		const result = await provisioner(declaration, context);
		context.provisioned[id] = result;
		Object.assign(env, result.provides);
	}

	return { context, env };
}

describe('serviceName', () => {
	const scope = { stage: 'prod', app: 'toolbox' };

	it('is the same scoped rule the AWS target uses', () => {
		// `cloudName` and nothing else, so a name reads identically on both
		// providers. It briefly carried a `-postgres` suffix on the theory that a
		// Dokploy project is one flat list; it is not — `project.one` returns
		// typed collections, so the kind is already in the shape of the response.
		expect(serviceName(scope, 'Database')).toBe('prod-toolbox-database');
		expect(serviceName(scope, 'Uploads')).toBe('prod-toolbox-uploads');
	});

	it('is not the name Postgres uses for the database', () => {
		// Snake inside Postgres, because every identifier touching it is; kebab
		// and scoped in the provider, because that is where collisions between
		// stages and apps happen.
		expect(serviceName(scope, 'Database')).not.toBe('database_prod');
	});
});

describe('the database', () => {
	it('connects a handler as the runtime role, never the cluster master', async () => {
		// The security property the split exists for: a compromised handler
		// cannot DROP TABLE, because its role holds no such grant. The master
		// password the API was given appears in no URL at all.
		const { env } = await provision();

		expect(env.ORDERS_URL).toMatch(/^postgres:\/\/orders_production:/);
		expect(env.ORDERS_URL).not.toContain('master-password');
	});

	it('reaches it on the internal network, not the public one', async () => {
		// A credential crossing the public internet to reach a database on the
		// same host is a credential on a network that did not need to see it.
		const { env } = await provision();

		expect(env.ORDERS_URL).toContain('@production-shop-orders-service:5432/');
	});

	it('keeps the owner URL off every manifest edge', async () => {
		// It exists — a migrator needs DDL rights — and nothing may depend on it,
		// so no edge can be granted those rights by mistake.
		const { env } = await provision();

		expect(env.ORDERS_OWNER_URL).toMatch(
			/^postgres:\/\/orders_production_owner:/,
		);
		expect(manifest.Orders.provides).not.toContain('ORDERS_OWNER_URL');
	});

	it('gives each role a password of its own', async () => {
		const { env } = await provision();

		expect(env.ORDERS_URL).not.toBe(env.ORDERS_OWNER_URL);
	});

	it('derives them, so a redeploy does not lock the app out', async () => {
		// A random password on every deploy would leave the running application
		// holding a credential the database no longer accepts.
		const [first, second] = await Promise.all([provision(), provision()]);

		expect(first.env.ORDERS_URL).toBe(second.env.ORDERS_URL);
	});

	it('does not share a credential between two projects', async () => {
		const other = await provision({ project: 'other' });
		const { env } = await provision();

		expect(other.env.ORDERS_URL).not.toBe(env.ORDERS_URL);
	});

	it('defers the role DDL rather than running it', async () => {
		// Creating a Postgres and creating a role inside it are different acts:
		// the second needs a connection to a cluster the first has only just
		// asked for. The same reason `DatabaseBootstrap` exists on AWS.
		const { context } = await provision();

		expect(context.deferred.map((s) => s.sql)).toContainEqual(
			expect.stringContaining('CREATE ROLE "orders_production"'),
		);
	});

	it('uses the shared generator, not DDL of its own', async () => {
		// Dokploy used to write its own `DO $$` block, which meant three targets
		// holding three definitions of the same split with no way to notice they
		// had drifted. `ALTER ROLE … SET search_path` is `roleStatements`'s.
		const { context } = await provision();

		expect(context.deferred.map((s) => s.sql)).toContainEqual(
			'ALTER ROLE "orders_production" SET search_path TO "app"',
		);
	});

	it('creates a reader role only where something reads through one', async () => {
		const { context } = await provision();
		const withoutReader = await provision({}, {
			Orders: manifest.Orders,
			Api: manifest.Api,
		} as ConstructManifest);

		expect(context.deferred.some((s) => s.sql.includes('_reader'))).toBe(true);
		expect(
			withoutReader.context.deferred.some((s) => s.sql.includes('_reader')),
		).toBe(false);
	});
});

describe('a schema tenant', () => {
	it('lives in its parent’s database, on a role of its own', async () => {
		// A tenant is a schema, never a database of its own — and its role is
		// what makes it a privilege boundary rather than a namespace.
		const { env } = await provision();

		expect(env.AUTH_DB_URL).toContain('/orders_production');
		expect(env.AUTH_DB_URL).toMatch(/^postgres:\/\/authdb_production:/);
	});

	it('pins its own schema, not its parent’s', async () => {
		const { context } = await provision();

		expect(context.deferred.map((s) => s.sql)).toContainEqual(
			'ALTER ROLE "authdb_production" SET search_path TO "authdb"',
		);
	});

	it('refuses to resolve before its parent has', async () => {
		const provisioner = provisionerFor('database-schema');

		await expect(
			provisioner?.(manifest.AuthDb, {
				...(await provision()).context,
				provisioned: {},
			}),
		).rejects.toThrow(UnresolvedParent);
	});
});

describe('a reader', () => {
	it('resolves to the writer’s endpoint, through a role that may only read', async () => {
		// One endpoint on a Dokploy Postgres, so this is the writer's address —
		// safe rather than a loophole, because read-only is enforced by the
		// grants and not by which host the URL names.
		const { env } = await provision();

		expect(env.ORDERS_READER_URL).toMatch(
			/^postgres:\/\/orders_production_reader:/,
		);
		expect(new URL(env.ORDERS_READER_URL as string).hostname).toBe(
			new URL(env.ORDERS_URL as string).hostname,
		);
	});
});

describe('the cache', () => {
	it('is a table in the declared database, with the table in its URL', async () => {
		// No second service and no second credential — the same relationship
		// pg-boss has. The table travels in the URL because two caches in one
		// database resolve the same connection string.
		const { env } = await provision();

		expect(env.SESSIONS_URL).toContain(
			'/orders_production?table=cache_sessions',
		);
	});

	it('creates that table in the schema the reading role resolves names in', async () => {
		const { context } = await provision();

		expect(context.deferred.map((s) => s.sql)).toContainEqual(
			expect.stringContaining('"app"."cache_sessions"'),
		);
	});

	it('hands it to the owner and grants the runtime role', async () => {
		// Default privileges cover what the *owner* creates, so a table the
		// master made is covered by none of them.
		const created = (await provision()).context.deferred.map((s) => s.sql);

		expect(created).toContainEqual(
			'ALTER TABLE "app"."cache_sessions" OWNER TO "orders_production_owner"',
		);
		expect(created).toContainEqual(
			expect.stringContaining(
				'GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."cache_sessions"',
			),
		);
	});

	it('refuses to guess which database, rather than picking the first', async () => {
		// A cache landing in a database nobody chose surfaces as entries that are
		// never found, long after the deploy reported success.
		const two = {
			Orders: manifest.Orders,
			Reports: { kind: 'database', id: 'Reports', provides: ['REPORTS_URL'] },
			Sessions: manifest.Sessions,
		} as ConstructManifest;

		await expect(provision({}, two)).rejects.toThrow(CacheIsAmbiguous);
	});

	it('refuses a cache with nowhere to live', async () => {
		await expect(
			provision({ cache: 'upstash' }, {
				Sessions: manifest.Sessions,
			} as ConstructManifest),
		).rejects.toThrow(CacheNeedsAHome);
	});
});

describe('a secret', () => {
	it('publishes the key the declaration names', async () => {
		// `environmentCase(id)` — `AuthSecret` is `AUTH_SECRET`. Deriving
		// `provideKey(id, 'value')` instead produced `AUTH_SECRET_VALUE`, which
		// nothing reads and nothing reported.
		const { env } = await provision();

		expect(env.AUTH_SECRET).toBeTruthy();
		expect(env).not.toHaveProperty('AUTH_SECRET_VALUE');
	});

	it('is stable across deploys, so live sessions survive one', async () => {
		const [first, second] = await Promise.all([provision(), provision()]);

		expect(first.env.AUTH_SECRET).toBe(second.env.AUTH_SECRET);
	});
});

describe('a surface', () => {
	it('resolves to the domain Dokploy issued for it', async () => {
		// Dokploy is the edge here: it runs Traefik and issues the certificate,
		// so nothing is provisioned and the address arrives rather than being
		// composed.
		const { env } = await provision();

		expect(env.API_URL).toBe('https://api.example.com');
	});

	it('publishes who may call it and where its cookie is readable', async () => {
		// Three facts, not one. Better Auth rejects an untrusted origin whether or
		// not it is a browser, so a surface that resolved only its own URL left
		// every caller locked out.
		const { env } = await provision();

		expect(env).toHaveProperty('API_TRUSTED_ORIGINS');
	});

	it('says so when it ran before the domain existed', async () => {
		await expect(provision({ addresses: {} })).rejects.toThrow(
			SurfaceHasNoAddress,
		);
	});
});
