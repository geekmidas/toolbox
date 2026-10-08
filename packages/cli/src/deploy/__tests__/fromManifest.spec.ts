import {
	type ConstructManifest,
	NoUrlForStage,
	provisionOrder,
} from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { ExternalServicesNotConfigured } from '../devServices';
import type { DokployApi } from '../dokploy-api';
import {
	BrokerNeedsADatabase,
	CacheIsAmbiguous,
	CacheNeedsAHome,
	type DokployProvisionContext,
	MissingSuppliedSecret,
	type Provisioned,
	provisionableKinds,
	provisionerFor,
	SurfaceHasNoAddress,
	serviceName,
	UnprovisionableBucket,
	UnprovisionableCarrier,
	UnresolvedParent,
	WrongKind,
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
		path: '.',
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
	const composeFiles = new Map<string, string>();

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
		async findOrCreateCompose(
			name: string,
			_projectId: string,
			_environmentId: string,
			composeFile: string,
		) {
			created.push(name);
			composeFiles.set(name, composeFile);

			return {
				compose: { composeId: `compose-${name}`, name, appName: `${name}-x` },
				created: true,
			};
		},
		async deployCompose() {},
	} as unknown as DokployApi;

	return { api, created, composeFiles };
}

async function provision(
	overrides: Partial<DokployProvisionContext> = {},
	source: ConstructManifest = manifest,
): Promise<{
	context: DokployProvisionContext;
	env: Record<string, string>;
	created: string[];
	composeFiles: Map<string, string>;
}> {
	const { api, created, composeFiles } = fakeApi();
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
		seed: 'stage-seed',
		...overrides,
		// What the deploy generated before provisioning — see generated.spec.
		supplied: { AUTH_SECRET: 'generated-signing-key', ...overrides.supplied },
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

	return { context, env, created, composeFiles };
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

describe('a bucket', () => {
	const storing = {
		...manifest,
		Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
		UploadsServer: {
			kind: 'file-server',
			id: 'UploadsServer',
			of: 'Uploads',
			open: ['brand/**'],
			provides: ['UPLOADS_SERVER_URL'],
		},
	} as ConstructManifest;

	it('is a compose stack, because Dokploy has no bucket primitive', async () => {
		// Postgres and Redis are first-class here and object storage is not, so
		// this is the one kind whose infrastructure the target writes rather
		// than configures.
		const { env } = await provision(
			{ storage: 'minio', devServices: ['minio'] },
			storing,
		);

		// Kebab, not snake: a bucket name is a DNS label, so it takes the
		// same rule a hostname does rather than the one a Postgres role does.
		expect(env.UPLOADS_URL).toContain('s3://uploads-production');
		expect(env.UPLOADS_URL).toContain('forcePathStyle=true');
	});

	it('is reached by the name every other service is named by', async () => {
		// Not cosmetic: containers on `dokploy-network` resolve each other by
		// service name, so the name is the address. Calling it `minio` would
		// work for exactly one project on the box and then collide.
		const { env } = await provision(
			{ storage: 'minio', devServices: ['minio'] },
			storing,
		);

		expect(env.UPLOADS_URL).toContain(
			'endpoint=http://production-shop-uploads:9000',
		);
	});

	it('keeps its credentials beside the URL, not inside it', async () => {
		// An `s3://` URL carries none deliberately: on AWS the SDK reads them
		// from an execution role, so a URL that embedded a key would be one more
		// thing to rotate and leak. There is no role here, so the same chain
		// reads these.
		const { env } = await provision(
			{ storage: 'minio', devServices: ['minio'] },
			storing,
		);

		expect(env.UPLOADS_URL).not.toContain('@');
		expect(env.AWS_ACCESS_KEY_ID).toBe('uploads-production-root');
		expect(env.AWS_SECRET_ACCESS_KEY).toBeTruthy();
	});

	it('refuses a bucket it cannot create rather than inventing one', async () => {
		// An S3 or R2 bucket belongs to an account this deploy does not hold,
		// the way an API key does.
		await expect(provision({ storage: 's3' }, storing)).rejects.toThrow(
			UnprovisionableBucket,
		);
	});

	it('serves the bucket at the address the bucket resolved to', async () => {
		const { env } = await provision(
			{ storage: 'minio', devServices: ['minio'] },
			storing,
		);

		expect(env.UPLOADS_SERVER_URL).toBe(
			'http://production-shop-uploads:9000/uploads-production',
		);
	});

	it('runs no MinIO on a deployed stage unless it is allowed to', async () => {
		// A bucket on one container's disk is not a deployed stage's storage.
		// `validate` refuses this first; the provisioner refuses it too.
		const run = provision({ storage: 'minio' }, storing);

		await expect(run).rejects.toThrow(ExternalServicesNotConfigured);
		await expect(run).rejects.toThrow(/UPLOADS_URL/);
		await expect(run).rejects.toThrow(/with --allow-dev-services\./);
	});

	it("is the stage's own bucket when its secrets hold one, and runs nothing", async () => {
		const external = {
			UPLOADS_URL: 's3://acme-uploads?region=eu-west-1',
			AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
			AWS_SECRET_ACCESS_KEY: 'external-secret',
			UPLOADS_SERVER_URL: 'https://files.example.com',
		};
		// Allowed or not: a URL the stage set wins over the dev service.
		const { env, created } = await provision(
			{ storage: 'minio', devServices: ['minio'], supplied: external },
			storing,
		);

		expect(env.UPLOADS_URL).toBe(external.UPLOADS_URL);
		expect(env.AWS_ACCESS_KEY_ID).toBe('AKIAEXAMPLE');
		expect(env.AWS_SECRET_ACCESS_KEY).toBe('external-secret');
		expect(env.UPLOADS_SERVER_URL).toBe('https://files.example.com');
		expect(created).not.toContain('production-shop-uploads');
	});

	it("passes a bucket URL's own key through, with no shared pair beside it", async () => {
		const UPLOADS_URL =
			's3://AKIAUPLOADS:a%2Fsecret%2Bvalue@acme-uploads?region=eu-west-1';
		const { env } = await provision(
			{
				storage: 'minio',
				supplied: {
					UPLOADS_URL,
					UPLOADS_SERVER_URL: 'https://files.example.com',
				},
			},
			storing,
		);

		expect(env.UPLOADS_URL).toBe(UPLOADS_URL);
		expect(env).not.toHaveProperty('AWS_ACCESS_KEY_ID');
		expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
	});

	it("signs MinIO with the stage's own key pair, where it set one", async () => {
		const { env, composeFiles } = await provision(
			{
				storage: 'minio',
				devServices: ['minio'],
				supplied: {
					AWS_ACCESS_KEY_ID: 'stage-key',
					AWS_SECRET_ACCESS_KEY: 'stage-secret-value',
				},
			},
			storing,
		);

		expect(env.AWS_ACCESS_KEY_ID).toBe('stage-key');
		expect(env.AWS_SECRET_ACCESS_KEY).toBe('stage-secret-value');
		expect(composeFiles.get('production-shop-uploads')).toContain(
			'MINIO_ROOT_USER: stage-key',
		);
	});
});

describe('mail', () => {
	const mailing = {
		...manifest,
		Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
	} as ConstructManifest;
	const smtp = 'smtp://user:password@smtp.example.com:587';

	it("is the stage's own SMTP server, with the address it sends from", async () => {
		const { env, created } = await provision(
			{ supplied: { MAIL_URL: smtp, MAIL_FROM: 'noreply@example.com' } },
			mailing,
		);

		expect(env.MAIL_URL).toBe(smtp);
		expect(env.MAIL_FROM).toBe('noreply@example.com');
		expect(created).not.toContain('production-shop-mail');
	});

	it('needs the sending address beside the URL', async () => {
		await expect(
			provision({ supplied: { MAIL_URL: smtp } }, mailing),
		).rejects.toThrow(MissingSuppliedSecret);
	});

	it('runs no Mailpit on a deployed stage unless it is allowed to', async () => {
		const run = provision({}, mailing);

		await expect(run).rejects.toThrow(ExternalServicesNotConfigured);
		await expect(run).rejects.toThrow(/MAIL_URL[\s\S]*MAIL_FROM/);
	});

	it('is a Mailpit compose service where allowed, named like every other', async () => {
		const { env, composeFiles } = await provision(
			{ devServices: ['mailpit'], domain: 'example.com' },
			mailing,
		);

		expect(env.MAIL_URL).toBe('smtp://production-shop-mail:1025');
		expect(env.MAIL_FROM).toBe('noreply@example.com');
		const file = composeFiles.get('production-shop-mail');
		expect(file).toContain('axllent/mailpit');
		expect(file).toContain('dokploy-network');
	});

	it('keeps a sending address the stage set, on Mailpit too', async () => {
		const { env } = await provision(
			{ devServices: ['mailpit'], supplied: { MAIL_FROM: 'hi@shop.test' } },
			mailing,
		);

		expect(env.MAIL_FROM).toBe('hi@shop.test');
	});
});

describe('a carrier', () => {
	const carrying = {
		...manifest,
		Users: {
			kind: 'topic',
			id: 'Users',
			provides: ['USERS_PUBLISHER_CONNECTION_STRING'],
		},
		Emails: {
			kind: 'queue',
			id: 'Emails',
			provides: ['EMAILS_PUBLISHER_CONNECTION_STRING'],
		},
	} as ConstructManifest;

	it('resolves to the database the app already declared', async () => {
		// Nothing is created in Dokploy for a topic. Under pg-boss the broker is
		// a schema tenant of the declared database, exactly as it is locally,
		// which is why the whole of provisioning one is composing an address.
		const { env } = await provision({}, carrying);

		expect(env.USERS_PUBLISHER_CONNECTION_STRING).toMatch(
			/^pgboss:\/\/orders_production_pgboss:/,
		);
		expect(env.USERS_PUBLISHER_CONNECTION_STRING).toContain(
			'@production-shop-orders-service:5432/orders_production?schema=pgboss',
		);
	});

	it('is one broker however many carriers are declared', async () => {
		// The generated pollers open a single connection and subscribe each
		// worker by name on it, so a topic and a queue are two names for one
		// address — and two identical sets of DDL would be a plan that said
		// otherwise.
		const { context, env } = await provision({}, carrying);

		expect(env.EMAILS_PUBLISHER_CONNECTION_STRING).toBe(
			env.USERS_PUBLISHER_CONNECTION_STRING,
		);
		expect(
			context.deferred.filter((statement) => statement.id === 'PgBoss').length,
		).toBeGreaterThan(0);
		expect(
			new Set(
				context.deferred
					.filter((statement) => statement.id === 'PgBoss')
					.map((statement) => statement.sql),
			).size,
		).toBe(context.deferred.filter((s) => s.id === 'PgBoss').length);
	});

	it('connects as its own role, not the cluster master', async () => {
		// pg-boss creates and owns its tables. A broker that could also read the
		// application's would be a grant nothing asked for.
		const { context, env } = await provision({}, carrying);

		expect(env.USERS_PUBLISHER_CONNECTION_STRING).not.toContain(
			'master-password',
		);
		expect(context.deferred.map((s) => s.sql)).toContainEqual(
			expect.stringContaining('CREATE ROLE "orders_production_pgboss"'),
		);
	});

	it('refuses a backend this target has no primitive for', async () => {
		// SNS needs a topic ARN that has to exist first. Composing a plausible
		// URL would fail at the first publish instead of here.
		await expect(provision({ events: 'sns' }, carrying)).rejects.toThrow(
			UnprovisionableCarrier,
		);
	});

	it('says so when there is no database to host it', async () => {
		const { Orders, AuthDb, OrdersReader, Sessions, ...rest } =
			carrying as Record<string, unknown>;

		await expect(
			provision({ cache: undefined }, rest as ConstructManifest),
		).rejects.toThrow(BrokerNeedsADatabase);
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

describe('provisioning out of order', () => {
	it.each(
		provisionableKinds(),
	)('the %s provisioner refuses a declaration of another kind', async (kind) => {
		const { context } = await provision();
		const stranger = {
			kind: kind === 'secret' ? 'cache' : 'secret',
			id: 'Stranger',
			provides: [],
		} as never;

		await expect(provisionerFor(kind)?.(stranger, context)).rejects.toThrow(
			WrongKind,
		);
	});

	it('a reader needs its database resolved first', async () => {
		const { context } = await provision();

		await expect(
			provisionerFor('database-reader')?.(manifest.OrdersReader, {
				...context,
				provisioned: {},
			}),
		).rejects.toThrow(UnresolvedParent);
	});

	it('a cache needs the database it names resolved, with a URL', async () => {
		const { context } = await provision();
		const cache = {
			kind: 'cache',
			id: 'Sessions',
			of: 'Orders',
			provides: ['SESSIONS_URL'],
		} as never;
		const run = (provisioned: Record<string, Provisioned>) =>
			provisionerFor('cache')?.(cache, { ...context, provisioned });

		await expect(run({})).rejects.toThrow(UnresolvedParent);
		await expect(run({ Orders: { provides: {} } })).rejects.toThrow(
			UnresolvedParent,
		);
	});

	it('a file server needs its bucket resolved, with an endpoint', async () => {
		const { context } = await provision();
		const server = {
			kind: 'file-server',
			id: 'UploadsServer',
			of: 'Uploads',
			provides: ['UPLOADS_SERVER_URL'],
		} as never;
		const run = (provisioned: Record<string, Provisioned>) =>
			provisionerFor('file-server')?.(server, { ...context, provisioned });

		await expect(run({})).rejects.toThrow(UnresolvedParent);
		await expect(
			run({ Uploads: { provides: { UPLOADS_URL: 's3://uploads' } } }),
		).rejects.toThrow(UnresolvedParent);
	});
});

describe('a cache in a database that names no schema', () => {
	it('lands in the default schema', async () => {
		const { context } = await provision({}, {
			Orders: {
				kind: 'database',
				id: 'Orders',
				engine: 'postgres',
				provides: ['ORDERS_URL'],
			},
			Sessions: {
				kind: 'cache',
				id: 'Sessions',
				of: 'Orders',
				provides: ['SESSIONS_URL'],
			},
		} as ConstructManifest);

		expect(
			context.deferred.filter((s) => s.id === 'Sessions').map((s) => s.sql),
		).toContainEqual(expect.stringMatching(/CREATE TABLE[^(]+"app"\./));
	});
});

describe('a secret that publishes nothing', () => {
	it('resolves to nothing', async () => {
		const { context } = await provision();

		await expect(
			provisionerFor('secret')?.(
				{ kind: 'secret', id: 'Unused', provides: [] } as never,
				context,
			),
		).resolves.toEqual({ provides: {} });
	});
});

describe('a surface with callers', () => {
	it('trusts each caller’s address and shares a cookie across their domain', async () => {
		const { env } = await provision(
			{
				addresses: {
					Api: 'https://api.shop.com',
					Web: 'https://shop.com',
					// A caller with no address yet contributes no origin.
					Admin: undefined as never,
				},
			},
			{
				Api: {
					kind: 'rest-api',
					id: 'Api',
					path: '.',
					endpoints: [],
					provides: ['API_URL'],
				},
				Web: {
					kind: 'rest-api',
					id: 'Web',
					path: '.',
					endpoints: [],
					calls: [{ target: 'Api', kind: 'rest-api' }],
					provides: ['WEB_URL'],
				},
				Admin: {
					kind: 'secret',
					id: 'Admin',
					dependencies: [{ target: 'Api', kind: 'rest-api' }],
					provides: [],
				},
			} as unknown as ConstructManifest,
		);

		expect(env.API_TRUSTED_ORIGINS).toBe('https://shop.com');
		expect(env.API_COOKIE_DOMAIN).toBe('.shop.com');
	});
});

describe('a surface a mobile app calls', () => {
	it('trusts the app’s bare scheme — what the store build registers', async () => {
		const { env } = await provision(
			{ addresses: { Auth: 'https://auth.shop.com' } },
			{
				Auth: {
					kind: 'rest-api',
					id: 'Auth',
					path: '.',
					endpoints: [],
					provides: ['AUTH_URL'],
				},
				App: {
					kind: 'mobile-app',
					id: 'App',
					variant: 'expo',
					app: { path: 'apps/app' },
					dependencies: [{ target: 'Auth', kind: 'rest-api' }],
					provides: ['APP_SCHEME'],
				},
			} as unknown as ConstructManifest,
		);

		// The project's name, unsuffixed: no development build answers it.
		expect(env.AUTH_TRUSTED_ORIGINS).toBe('shop://,shop://*');
		// A scheme is not a host anything shares a cookie with.
		expect(env.AUTH_COOKIE_DOMAIN).toBeUndefined();
	});
});

describe('a third party’s credentials', () => {
	const stripe = {
		Stripe: {
			kind: 'credential',
			id: 'Stripe',
			provides: ['STRIPE_CREDENTIALS'],
		},
	} as unknown as ConstructManifest;

	it('come from what the stage was given', async () => {
		const { env } = await provision(
			{ supplied: { STRIPE_CREDENTIALS: '{"secretKey":"sk_live_1"}' } },
			stripe,
		);

		expect(env.STRIPE_CREDENTIALS).toBe('{"secretKey":"sk_live_1"}');
	});

	it('fail the deploy when the stage was never given them, naming the command', async () => {
		await expect(provision({}, stripe)).rejects.toThrow(MissingSuppliedSecret);
		await expect(provision({}, stripe)).rejects.toThrow(
			"gkm secrets:set STRIPE_CREDENTIALS '…' --stage production",
		);
	});
});

describe('an encryption key on a server', () => {
	const pii = {
		Pii: { kind: 'encryption', id: 'Pii', provides: ['PII_URL'] },
	} as unknown as ConstructManifest;

	it('is the keyring the stage keeps, rotated keys and all', async () => {
		const keyring = 'aes256gcm://local?keys=k2.a,k1.b&index=c';
		const { env } = await provision({ supplied: { PII_URL: keyring } }, pii);

		expect(env.PII_URL).toBe(keyring);
	});
});

describe('an external API', () => {
	const payfast = {
		PayFast: {
			kind: 'external-api',
			id: 'PayFast',
			url: {
				production: 'https://www.payfast.co.za',
				default: 'https://sandbox.payfast.co.za',
			},
			provides: ['PAY_FAST_URL', 'PAY_FAST_CREDENTIALS'],
		},
	} as unknown as ConstructManifest;
	const supplied = { PAY_FAST_CREDENTIALS: '{"merchantId":"m_1"}' };

	it('is called at the URL for its stage, with the stage’s credentials', async () => {
		const { env } = await provision({ supplied }, payfast);

		expect(env).toMatchObject({
			PAY_FAST_URL: 'https://www.payfast.co.za',
			PAY_FAST_CREDENTIALS: '{"merchantId":"m_1"}',
		});
	});

	it('falls back to the default URL for a stage it does not name', async () => {
		const { env } = await provision({ supplied, stage: 'staging' }, payfast);

		expect(env.PAY_FAST_URL).toBe('https://sandbox.payfast.co.za');
	});

	it('fails the deploy when the stage was never given its credentials', async () => {
		await expect(provision({}, payfast)).rejects.toThrow(MissingSuppliedSecret);
	});

	it('fails the deploy for a stage it has no URL for', async () => {
		const prodOnly = {
			PayFast: {
				...payfast.PayFast,
				url: { production: 'https://www.payfast.co.za' },
			},
		} as unknown as ConstructManifest;

		await expect(
			provision({ supplied, stage: 'staging' }, prodOnly),
		).rejects.toThrow(NoUrlForStage);
	});
});

describe('what a deploy derives', () => {
	it('salts every derived password with the stage’s seed', async () => {
		const first = await provision({ seed: 'seed-one' });
		const second = await provision({ seed: 'seed-two' });

		expect(first.env.ORDERS_URL).not.toBe(second.env.ORDERS_URL);
		// The same seed, the same password: a redeploy locks nobody out.
		expect((await provision({ seed: 'seed-one' })).env.ORDERS_URL).toBe(
			first.env.ORDERS_URL,
		);
	});

	it('cannot be computed from what the repo holds', async () => {
		// The old derivation: project, stage and role, all in the repo.
		const { createHash } = await import('node:crypto');
		const guess = createHash('sha256')
			.update('shop:production:role:orders_production')
			.digest('base64url')
			.slice(0, 32);

		const { env } = await provision();

		expect(env.ORDERS_URL).not.toContain(encodeURIComponent(guess));
	});

	it('signs with the stage’s stored key, never a derived one', async () => {
		const { env } = await provision({
			supplied: { AUTH_SECRET: 'stored-signing-key' },
		});

		expect(env.AUTH_SECRET).toBe('stored-signing-key');
	});
});
