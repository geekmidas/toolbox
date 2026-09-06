/**
 * The Dokploy target, read off the construct manifest.
 *
 * The AWS target has done this since `fromManifest` landed: a table keyed by
 * declaration kind, each entry turning one declaration into infrastructure and
 * the env keys it resolves. Dokploy had no such thing — it resolved environment
 * from the *sniffer*, which walks application code for `get('X')` calls, and a
 * construct reads its own key inside `@geekmidas/constructs` where there is
 * nothing to find. So a declared app deployed here got none of the model, and
 * nothing reported the absence: the deploy succeeded and the first request that
 * needed a URL failed at runtime.
 *
 * This is the same table, over the REST wrapper instead of over Pulumi.
 *
 * **Two phases, and the split is not incidental.** Creating a Postgres and
 * creating a role inside it are different kinds of act: the first is an API
 * call, the second needs a connection to a database that does not exist yet
 * when the call is made. So provisioners *accumulate* DDL rather than running
 * it, and it is applied once against a cluster that is up — which is exactly
 * what `DatabaseBootstrap` does on AWS, for exactly the same reason.
 *
 * **The DDL itself is shared.** `roleStatements` and `cacheTableStatements` are
 * the same generators the local target and the AWS target use. Dokploy used to
 * write its own `DO $$` block, which meant three targets applying three
 * different definitions of "the role split" and no way to notice they had
 * drifted.
 *
 * Entries are deliberately small and free of I/O ordering: each takes what it
 * needs and returns what it resolved. That is what would let a Pulumi dynamic
 * provider wrap one later without the table itself changing — see §6b.
 */

import { createHash } from 'node:crypto';
import { cacheTableStatements } from '@geekmidas/cache/postgres';
import {
	ownerRole,
	type RoleStatement,
	readerRole,
	roleStatements,
} from '@geekmidas/db/pg/roles';
import {
	type ConstructManifest,
	cacheTable,
	cloudName,
	cookieDomain,
	type Declaration,
	type DeclarationKind,
	dependentsOf,
	provideKey,
} from '@geekmidas/manifest';
import { resourceName } from '../reconcile/plan.js';
import type { DokployApi } from './dokploy-api';

/** What one provisioned construct resolves for anything that depends on it. */
export interface Provisioned {
	/** The env keys this construct publishes, and their values. */
	provides: Record<string, string>;
}

/** A statement to run once the cluster it operates on is reachable. */
export interface DeferredStatement extends RoleStatement {
	/** The construct that asked for it, so a failure can name one. */
	id: string;
	/** The database to connect to, where it is not the cluster's default. */
	database?: string;
}

export interface DokployProvisionContext {
	manifest: ConstructManifest;
	/** Everything already provisioned. Parents are present; siblings may not be. */
	provisioned: Record<string, Provisioned>;
	api: DokployApi;
	projectId: string;
	environmentId: string;
	/** The stage, which scopes every name exactly as it does locally. */
	stage: string;
	/**
	 * Seeds every derived password.
	 *
	 * Derived rather than random so a second deploy does not lock the running
	 * app out of its own database, and seeded per project so two projects do not
	 * share a credential.
	 */
	project: string;
	/** Where a declared cache lives — the same config the other targets read. */
	cache?: 'upstash' | 'elasticache' | 'db';
	/** Where a declared bucket lives. Only `minio` has a Dokploy primitive. */
	storage?: 'minio' | 's3' | 'r2';
	/**
	 * What carries a declared queue or topic — the same config the local target
	 * reads, and for the same reason it is config rather than a declaration: the
	 * handlers are written once and the transport is a deployment choice.
	 */
	events?: 'pgboss' | 'sns' | 'rabbitmq';
	/**
	 * Where each surface answers, keyed by construct id.
	 *
	 * Assigned by whatever created the domain, which is the existing engine —
	 * so it arrives here rather than being composed, the same way the local
	 * target receives addresses it did not choose.
	 */
	addresses?: Readonly<Record<string, string>>;
	/**
	 * Secrets already generated for this stage, so a redeploy does not rotate
	 * one and invalidate every live session.
	 */
	secrets?: Readonly<Record<string, string>>;
	/** DDL accumulated by the provisioners, applied once at the end. */
	deferred: DeferredStatement[];
	/**
	 * The Postgres each declared database resolved to, keyed by database name.
	 *
	 * Recorded because the deferred DDL has to run against *the cluster the
	 * manifest created*, and nothing else knows which that is: a project may
	 * also have a legacy `services.postgres`, and applying a construct's roles
	 * to that one would create them where nothing connects.
	 */
	clusters: Record<string, DokployCluster>;
}

/** The half of a Dokploy Postgres a caller outside this module needs. */
export interface DokployCluster {
	postgresId: string;
	appName: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
}

type Provisioner = (
	declaration: Declaration,
	context: DokployProvisionContext,
) => Promise<Provisioned>;

/**
 * The internal hostname a Dokploy Postgres answers on.
 *
 * Its own service name on the Docker network — not the server's public address.
 * An app reaching its database over the public internet would be a credential
 * crossing a network that did not need to see it.
 */
function clusterHost(postgres: { appName: string }): string {
	return postgres.appName;
}

/**
 * What a resource is called in the provider.
 *
 * `cloudName` and nothing else — the same scoped kebab rule the AWS target
 * uses, so a name reads identically on both: `production-shop-orders`.
 *
 * It briefly carried a `-postgres` suffix on the theory that a Dokploy project
 * is one flat list where an application and its database would collide. It is
 * not: `project.one` returns typed collections — `applications`, `postgres`,
 * `redis`, `compose`, `mariadb`, `mongo`, `mysql` — so the kind is already in
 * the shape of the response and an application and a Postgres of the same name
 * are different objects with different ids. The suffix was answering a question
 * nobody had asked.
 */
export function serviceName(
	scope: { stage: string; app: string },
	id: string,
): string {
	return cloudName(scope, id);
}

const PROVISIONERS: Partial<Record<DeclarationKind, Provisioner>> = {
	/**
	 * A Postgres service, plus the roles that reach it.
	 *
	 * The service is `findOrCreate`, because a deploy that recreated the
	 * database would be a deploy that lost the data. The roles are deferred:
	 * they need a connection to a cluster this call has only just asked for.
	 */
	database: async (declaration, context) => {
		if (declaration.kind !== 'database') throw new WrongKind(declaration.kind);

		// Two names, deliberately: what Postgres calls the database, and what the
		// Dokploy service list calls the service.
		const name = resourceName(declaration.id, declaration.kind, context.stage);
		const { postgres } = await context.api.findOrCreatePostgres(
			serviceName(
				{ stage: context.stage, app: context.project },
				declaration.id,
			),
			context.projectId,
			context.environmentId,
			{
				databaseName: name,
				// The cluster master, which nothing in the application ever holds:
				// every handler connects as a role created *by* this one.
				databasePassword: derivedPassword(context, `${name}:master`),
			},
		);

		const host = clusterHost(postgres);
		context.clusters[postgres.databaseName] = postgres;
		const schema = declaration.schema ?? 'app';
		const runtime = name;
		const owner = ownerRole(runtime);
		const reads = readsFrom(context.manifest, declaration.id);

		context.deferred.push(
			...statementsFor({
				id: declaration.id,
				database: postgres.databaseName,
				runtime,
				owner,
				...(reads ? { reader: readerRole(runtime) } : {}),
				schema,
				context,
			}),
		);

		return {
			provides: {
				[provideKey(declaration.id, 'url')]: postgresUrl(
					runtime,
					derivedPassword(context, runtime),
					host,
					postgres.databaseName,
				),
				// Deliberately not in `provides` on any manifest edge — the migrator
				// reads it from the injected environment and nothing can depend on
				// it, so DDL rights are never granted by an edge.
				[provideKey(declaration.id, 'ownerUrl')]: postgresUrl(
					owner,
					derivedPassword(context, owner),
					host,
					postgres.databaseName,
				),
			},
		};
	},

	/**
	 * A schema in the parent's database, with its own role and its own URL — so
	 * the parent's role holds no grant on these tables at all.
	 */
	'database-schema': async (declaration, context) => {
		if (declaration.kind !== 'database-schema')
			throw new WrongKind(declaration.kind);

		const parent = context.provisioned[declaration.of];
		if (!parent) throw new UnresolvedParent(declaration.id, declaration.of);

		const runtime = resourceName(
			declaration.id,
			declaration.kind,
			context.stage,
		);
		const owner = ownerRole(runtime);
		const reads = readsFrom(context.manifest, declaration.id);
		const parentUrl = new URL(
			parent.provides[provideKey(declaration.of, 'url')] ?? '',
		);

		context.deferred.push(
			...statementsFor({
				id: declaration.id,
				database: parentUrl.pathname.slice(1),
				runtime,
				owner,
				...(reads ? { reader: readerRole(runtime) } : {}),
				schema: declaration.schema,
				context,
			}),
		);

		return {
			provides: {
				[provideKey(declaration.id, 'url')]: postgresUrl(
					runtime,
					derivedPassword(context, runtime),
					parentUrl.hostname,
					parentUrl.pathname.slice(1),
				),
				[provideKey(declaration.id, 'ownerUrl')]: postgresUrl(
					owner,
					derivedPassword(context, owner),
					parentUrl.hostname,
					parentUrl.pathname.slice(1),
				),
			},
		};
	},

	/**
	 * A read-only endpoint on the same cluster.
	 *
	 * Nothing is provisioned: a Dokploy Postgres has one endpoint, so this
	 * resolves to the writer's address — and that is safe rather than a
	 * loophole, because read-only is enforced by the reader role's grants and
	 * not by which host the URL names. The role itself was created with its
	 * parent.
	 */
	'database-reader': async (declaration, context) => {
		if (declaration.kind !== 'database-reader')
			throw new WrongKind(declaration.kind);

		const parent = context.provisioned[declaration.of];
		if (!parent) throw new UnresolvedParent(declaration.id, declaration.of);

		const parentUrl = new URL(
			parent.provides[provideKey(declaration.of, 'url')] ?? '',
		);
		const reader = readerRole(parentUrl.username);

		return {
			provides: {
				[provideKey(declaration.id, 'url')]: postgresUrl(
					reader,
					derivedPassword(context, reader),
					parentUrl.hostname,
					parentUrl.pathname.slice(1),
				),
			},
		};
	},

	/**
	 * A cache, wherever the project said it lives.
	 *
	 * `db` is a table in a database the manifest already declares, so it
	 * provisions no service and costs nothing to run — the same relationship
	 * pg-boss has. The table's DDL is deferred with the roles, and the table
	 * name travels in the URL because two caches in one database resolve the
	 * same connection string.
	 */
	cache: async (declaration, context) => {
		if (declaration.kind !== 'cache') throw new WrongKind(declaration.kind);

		const parentId =
			declaration.of ??
			(context.cache === 'db' ? soleDatabase(context) : undefined);

		if (!parentId) throw new CacheNeedsAHome(declaration.id, context.cache);

		const parent = context.provisioned[parentId];
		if (!parent) throw new UnresolvedParent(declaration.id, parentId);

		const parentUrl = parent.provides[provideKey(parentId, 'url')];
		if (!parentUrl) throw new UnresolvedParent(declaration.id, parentId);

		const table = declaration.table ?? cacheTable(declaration.id);
		const schema = schemaOf(context.manifest, parentId);
		const qualified = schema ? `${schema}.${table}` : table;

		context.deferred.push(
			...cacheTableStatements({ table: qualified }).map((statement) => ({
				id: declaration.id,
				database: new URL(parentUrl).pathname.slice(1),
				describe: statement.describe,
				sql: statement.sql,
				...(statement.exists ? { exists: statement.exists } : {}),
			})),
			// Created by the master, so it belongs to nobody the app connects as
			// until it is handed over — and default privileges cover only what the
			// owner creates.
			{
				id: declaration.id,
				database: new URL(parentUrl).pathname.slice(1),
				describe: `${qualified} is owned by its schema's owner`,
				sql: `ALTER TABLE ${quoted(qualified)} OWNER TO ${quoted(ownerRole(new URL(parentUrl).username))}`,
			},
			{
				id: declaration.id,
				database: new URL(parentUrl).pathname.slice(1),
				describe: `${new URL(parentUrl).username} may read and write ${qualified}`,
				sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoted(qualified)} TO ${quoted(new URL(parentUrl).username)}`,
			},
		);

		const url = new URL(parentUrl);
		url.searchParams.set('table', table);

		return {
			provides: { [provideKey(declaration.id, 'url')]: url.toString() },
		};
	},

	/**
	 * A bucket, as a MinIO stack on the box.
	 *
	 * Dokploy has first-class primitives for Postgres and Redis and none for
	 * object storage, so this is the one kind whose infrastructure this target
	 * *writes* rather than configures — a compose file with one service in it.
	 *
	 * The service is named `cloudName(...)` like everything else, which is not
	 * cosmetic here: containers on `dokploy-network` resolve each other by
	 * service name, so the name is the address. Calling it `minio` would work
	 * for exactly one project on the box and then collide.
	 *
	 * `s3://` carries no credentials, deliberately — deployed on AWS the SDK
	 * reads them from an execution role, so a URL that embedded a key would be
	 * one more thing to rotate and leak. There is no role here, so the same
	 * chain reads `AWS_ACCESS_KEY_ID` beside the URL, exactly as it does
	 * locally.
	 */
	objects: async (declaration, context) => {
		if (declaration.kind !== 'objects') throw new WrongKind(declaration.kind);

		const backend = context.storage ?? 'minio';
		if (backend !== 'minio')
			throw new UnprovisionableBucket(declaration.id, backend);

		const service = serviceName(
			{ stage: context.stage, app: context.project },
			declaration.id,
		);
		const bucket = resourceName(
			declaration.id,
			declaration.kind,
			context.stage,
		);
		const user = `${bucket}-root`;
		const password = derivedPassword(context, `objects:${declaration.id}`);

		const { compose } = await context.api.findOrCreateCompose(
			service,
			context.projectId,
			context.environmentId,
			minioCompose({ service, bucket, user, password }),
		);

		await context.api.deployCompose(compose.composeId);

		return {
			provides: {
				[provideKey(declaration.id, 'url')]: s3Url(service, bucket),
				// Beside the URL rather than inside it, for the reason above.
				AWS_ACCESS_KEY_ID: user,
				AWS_SECRET_ACCESS_KEY: password,
				AWS_REGION: MINIO_REGION,
			},
		};
	},

	/**
	 * The address a bucket's objects are served on.
	 *
	 * Nothing is provisioned: Dokploy runs Traefik, so a second reverse proxy
	 * behind the first would terminate TLS twice — which is why the local
	 * target's Caddy has no equivalent here. What this resolves is the address,
	 * and the `open` prefixes are applied to the bucket rather than to an edge,
	 * so a policy is what makes them public wherever the bucket lives.
	 *
	 * Until a Traefik rule exists it answers on MinIO directly, path-style,
	 * which is honest about the shape it has today: the bucket is in the path
	 * rather than fronted by a host of its own.
	 */
	'file-server': async (declaration, context) => {
		if (declaration.kind !== 'file-server')
			throw new WrongKind(declaration.kind);

		const parent = context.provisioned[declaration.of];
		const parentUrl = parent?.provides[provideKey(declaration.of, 'url')];
		if (!parentUrl) throw new UnresolvedParent(declaration.id, declaration.of);

		const endpoint = new URL(parentUrl).searchParams.get('endpoint');
		const bucket = new URL(parentUrl).hostname;
		if (!endpoint) throw new UnresolvedParent(declaration.id, declaration.of);

		return {
			provides: {
				[provideKey(declaration.id, 'url')]: `${endpoint}/${bucket}`,
			},
		};
	},

	/**
	 * A topic, and below it a queue — the same broker either way.
	 *
	 * Under pg-boss there is nothing to create in Dokploy: the broker is a
	 * schema tenant of the database the app already declared, exactly as it is
	 * locally, so what this resolves is an address rather than a service. Which
	 * is the point of putting the backend in config — the same handlers drain
	 * pg-boss here and SQS on AWS because the string they were handed said so.
	 *
	 * The tenant gets its own role rather than the cluster master, for the
	 * reason every other tenant does: pg-boss creates and owns its tables, and
	 * a broker that could also read the application's is a broker with a grant
	 * nothing asked for.
	 */
	topic: async (declaration, context) => {
		if (declaration.kind !== 'topic') throw new WrongKind(declaration.kind);

		return broker(declaration.id, context);
	},

	queue: async (declaration, context) => {
		if (declaration.kind !== 'queue') throw new WrongKind(declaration.kind);

		return broker(declaration.id, context);
	},

	/**
	 * A signing key, generated once and remembered.
	 *
	 * Regenerating it on every deploy would invalidate every live session, which
	 * is why the value comes from state when there is one. Nothing is created in
	 * Dokploy: a secret has no address.
	 */
	secret: async (declaration, context) => {
		if (declaration.kind !== 'secret') throw new WrongKind(declaration.kind);

		// The key the declaration publishes, not one derived here. A secret's key
		// is `environmentCase(id)` — `AuthSecret` becomes `AUTH_SECRET` — and
		// deriving `provideKey(id, 'value')` instead produced `AUTH_SECRET_VALUE`,
		// which nothing reads. Keys come from the declaration for exactly this
		// reason: what the build publishes and what the app reads cannot drift.
		const key = declaration.provides?.[0];
		if (!key) return { provides: {} };

		return {
			provides: {
				[key]:
					context.secrets?.[key] ??
					derivedPassword(context, `secret:${declaration.id}`),
			},
		};
	},

	/**
	 * A surface, at the address whatever created its domain assigned.
	 *
	 * Nothing is provisioned here: the application and its domain are the
	 * existing engine's, and Dokploy's own Traefik terminates TLS with a Let's
	 * Encrypt certificate. What this adds is the *derivation* — who may call it,
	 * and where a cookie it sets is readable — from the graph rather than from a
	 * hand-maintained list.
	 */
	'rest-api': async (declaration, context) => {
		if (declaration.kind !== 'rest-api') throw new WrongKind(declaration.kind);

		const url = context.addresses?.[declaration.id];
		if (!url) throw new SurfaceHasNoAddress(declaration.id);

		// A surface publishes three facts, not one: where it answers, who may
		// call it, and where a cookie it sets is readable. The last two are
		// derived from its *inbound* edges — the constructs that declared they
		// call it — which is the same derivation the local target makes and the
		// reason neither is a list anybody maintains.
		//
		// Returning only the URL left `AUTH_TRUSTED_ORIGINS` and
		// `AUTH_COOKIE_DOMAIN` unresolved, and Better Auth rejects an untrusted
		// origin whether or not it is a browser.
		const origins = [
			...new Set(
				dependentsOf(context.manifest, declaration.id)
					.map((caller) => context.addresses?.[caller])
					.filter((address): address is string => Boolean(address)),
			),
		].sort();

		const domain = cookieDomain([url, ...origins]);

		return {
			provides: {
				[provideKey(declaration.id, 'url')]: url,
				[provideKey(declaration.id, 'trustedOrigins')]: origins.join(','),
				...(domain
					? { [provideKey(declaration.id, 'cookieDomain')]: domain }
					: {}),
			},
		};
	},
};

/** The provisioner for a kind, or nothing where this target has none yet. */
export function provisionerFor(kind: DeclarationKind): Provisioner | undefined {
	return PROVISIONERS[kind];
}

/** Which kinds this target can provision today — the rest are §6b's remainder. */
export function provisionableKinds(): DeclarationKind[] {
	return Object.keys(PROVISIONERS) as DeclarationKind[];
}

/**
 * The role DDL for one database or tenant, from the shared generator.
 *
 * The same statements the local target applies and the same ones the AWS
 * bootstrap runs. Dokploy used to write its own, which is how three targets
 * came to hold three definitions of the same split.
 */
function statementsFor(options: {
	id: string;
	database: string;
	runtime: string;
	owner: string;
	reader?: string;
	schema: string;
	context: DokployProvisionContext;
}): DeferredStatement[] {
	const { id, database, runtime, owner, reader, schema, context } = options;

	return roleStatements({
		runtime,
		owner,
		...(reader ? { reader } : {}),
		schema,
		passwords: {
			runtime: derivedPassword(context, runtime),
			owner: derivedPassword(context, owner),
			...(reader ? { reader: derivedPassword(context, reader) } : {}),
		},
	}).map((statement) => ({ ...statement, id, database }));
}

/**
 * The connection string a declared queue or topic publishes on.
 *
 * One broker for the whole project, which is what the local target does and
 * what the runtime expects: the generated pollers open a single connection and
 * subscribe each worker by name on it. So every carrier resolves to the same
 * address, and the DDL that backs it is pushed once however many are declared.
 *
 * Only pg-boss is answered here. SNS needs a topic ARN that has to exist
 * first, and RabbitMQ needs a broker Dokploy has no primitive for — both are
 * the §4.3 question, and composing a plausible URL for either would fail at the
 * first publish instead of here.
 */
function broker(id: string, context: DokployProvisionContext): Provisioned {
	const backend = context.events ?? 'pgboss';
	if (backend !== 'pgboss') throw new UnprovisionableCarrier(id, backend);

	const parentId = soleDatabase(context);
	if (!parentId) throw new BrokerNeedsADatabase(id);

	const parent = context.provisioned[parentId];
	const parentUrl = parent?.provides[provideKey(parentId, 'url')];
	if (!parentUrl) throw new UnresolvedParent(id, parentId);

	const url = new URL(parentUrl);
	const database = url.pathname.slice(1);
	const runtime = `${database}_${PGBOSS_SCHEMA}`;
	const owner = ownerRole(runtime);

	// Pushed under a fixed id rather than the carrier's, so a project declaring
	// a topic *and* a queue defers one set of statements rather than two
	// identical ones. The applier is convergent either way; this keeps the plan
	// honest about there being one broker.
	if (!context.provisioned[BROKER_ID]) {
		context.deferred.push(
			...statementsFor({
				id: BROKER_ID,
				database,
				runtime,
				owner,
				schema: PGBOSS_SCHEMA,
				context,
			}),
		);
		context.provisioned[BROKER_ID] = { provides: {} };
	}

	const connection = pgbossUrl(
		runtime,
		derivedPassword(context, runtime),
		url.host,
		database,
	);

	return {
		provides: {
			[provideKey(id, 'publisherConnectionString')]: connection,
		},
	};
}

/** The schema pg-boss creates its tables in, here as locally. */
const PGBOSS_SCHEMA = 'pgboss';

/**
 * The id the broker's DDL is pushed under.
 *
 * Not a construct — no declaration names it — but the deferred statements need
 * an id, and every carrier in the project shares this one.
 */
const BROKER_ID = 'PgBoss';

/**
 * A pg-boss address: a Postgres URL under a scheme that picks the transport.
 *
 * The protocol is what a producer branches on, so it never branches — the same
 * `.publish()` reaches pg-boss here and SQS on AWS.
 */
function pgbossUrl(
	role: string,
	password: string,
	host: string,
	database: string,
): string {
	return `pgboss://${role}:${encodeURIComponent(password)}@${host}/${database}?schema=${PGBOSS_SCHEMA}`;
}

/** The region MinIO is addressed with. It has no regions; the SDK wants one. */
const MINIO_REGION = 'us-east-1';

/** An `s3://` URL pointing the same S3 client at MinIO on the internal network. */
function s3Url(service: string, bucket: string): string {
	return (
		`s3://${bucket}?region=${MINIO_REGION}` +
		`&endpoint=http://${service}:9000&forcePathStyle=true`
	);
}

/**
 * A one-service compose file for a bucket.
 *
 * `dokploy-network` is external and already exists — it is what every Dokploy
 * service is attached to, and joining it is what makes the app able to resolve
 * this one by name. The bucket itself is created by MinIO's entrypoint rather
 * than by a second call, so there is nothing to reconcile afterwards.
 */
function minioCompose(options: {
	service: string;
	bucket: string;
	user: string;
	password: string;
}): string {
	const { service, bucket, user, password } = options;

	return [
		'services:',
		`  ${service}:`,
		'    image: minio/minio:latest',
		`    command: server /data --console-address ":9001"`,
		'    environment:',
		`      MINIO_ROOT_USER: ${user}`,
		`      MINIO_ROOT_PASSWORD: ${password}`,
		'    volumes:',
		`      - ${service}-data:/data`,
		'    networks:',
		'      - dokploy-network',
		'    healthcheck:',
		'      test: ["CMD", "mc", "ready", "local"]',
		'      interval: 10s',
		'      retries: 5',
		`  ${service}-bucket:`,
		'    image: minio/mc:latest',
		'    depends_on:',
		`      ${service}:`,
		'        condition: service_healthy',
		'    entrypoint: >',
		`      /bin/sh -c "mc alias set s3 http://${service}:9000 ${user} ${password} &&`,
		`      mc mb --ignore-existing s3/${bucket}"`,
		'    networks:',
		'      - dokploy-network',
		'volumes:',
		`  ${service}-data:`,
		'networks:',
		'  dokploy-network:',
		'    external: true',
		'',
	].join('\n');
}

/** Whether anything reads through a reader on this construct. */
function readsFrom(manifest: ConstructManifest, id: string): boolean {
	return Object.values(manifest).some(
		(declaration) =>
			declaration.kind === 'database-reader' && declaration.of === id,
	);
}

/** The schema a database or tenant pins on its roles. */
function schemaOf(manifest: ConstructManifest, id: string): string | undefined {
	const declaration = manifest[id];
	if (!declaration) return undefined;

	return 'schema' in declaration
		? ((declaration.schema as string | undefined) ?? 'app')
		: undefined;
}

/**
 * The one declared database, where `cache: 'db'` has to pick.
 *
 * Unambiguous with one and arbitrary with two, so two is an error rather than a
 * coin toss — a cache landing in a database nobody chose surfaces as entries
 * that are never found, long after the deploy reported success.
 */
function soleDatabase(context: DokployProvisionContext): string | undefined {
	const databases = Object.entries(context.manifest)
		.filter(([, declaration]) => declaration.kind === 'database')
		.map(([id]) => id);

	if (databases.length > 1) {
		throw new CacheIsAmbiguous(databases);
	}

	return databases[0];
}

/**
 * A password derived from the project, the stage and the role.
 *
 * Derived rather than random for the reason the local target derives its own: a
 * redeploy must not lock the running application out of its own database, and
 * two projects must not share a credential.
 */
function derivedPassword(
	context: DokployProvisionContext,
	role: string,
): string {
	return createHash('sha256')
		.update(`${context.project}:${context.stage}:role:${role}`)
		.digest('base64url')
		.slice(0, 32);
}

/** A connection string for a role on a cluster. */
function postgresUrl(
	role: string,
	password: string,
	host: string,
	database: string,
): string {
	return `postgres://${role}:${encodeURIComponent(password)}@${host}:5432/${database}`;
}

/** Quote an identifier, per segment, for DDL that cannot be parameterised. */
function quoted(name: string): string {
	return name
		.split('.')
		.map((part) => `"${part.replace(/"/g, '""')}"`)
		.join('.');
}

/** A provisioner was handed a declaration of the wrong kind. */
export class WrongKind extends Error {
	constructor(readonly kind: string) {
		super(`No Dokploy provisioner handles '${kind}'`);
		this.name = 'WrongKind';
	}
}

/** A derived construct whose parent has not been provisioned. */
export class UnresolvedParent extends Error {
	constructor(
		readonly id: string,
		readonly parent: string,
	) {
		super(
			`'${id}' derives from '${parent}', which has not been provisioned. ` +
				`Provision in \`provisionOrder\`, which puts parents first.`,
		);
		this.name = 'UnresolvedParent';
	}
}

/** A cache with nowhere to live. */
export class CacheNeedsAHome extends Error {
	constructor(
		readonly id: string,
		readonly backend: string | undefined,
	) {
		super(
			`'${id}' is a cache and nothing says where it lives. Declare it from ` +
				`its database — \`orders.cache('${id}')\` — or set services.cache.` +
				(backend ? ` The configured backend is '${backend}'.` : ''),
		);
		this.name = 'CacheNeedsAHome';
	}
}

/** `services.cache: 'db'` in an app declaring more than one database. */
export class CacheIsAmbiguous extends Error {
	constructor(readonly databases: readonly string[]) {
		super(
			`A cache backed by the database needs to know which one, and this app ` +
				`declares ${databases.length}: ${databases.join(', ')}. Declare the ` +
				`cache from its database rather than with services.cache.`,
		);
		this.name = 'CacheIsAmbiguous';
	}
}

/** A surface reached provisioning before its domain existed. */
export class SurfaceHasNoAddress extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' is a surface and no address was supplied for it. The domain is ` +
				`created before the manifest is provisioned, so this means the two ` +
				`ran out of order.`,
		);
		this.name = 'SurfaceHasNoAddress';
	}
}

/** A queue or topic on a backend this target has no primitive for. */
export class UnprovisionableCarrier extends Error {
	constructor(
		readonly id: string,
		readonly backend: string,
	) {
		super(
			`'${id}' is carried by '${backend}', which this target cannot ` +
				`provision. SNS needs a topic ARN that has to exist first and ` +
				`RabbitMQ needs a broker Dokploy has no primitive for; pg-boss is a ` +
				`schema tenant of a database this app already declares, which is why ` +
				`it is the one that works here. Set services.events to 'pgboss', or ` +
				`deploy this app to a target that has the backend.`,
		);
		this.name = 'UnprovisionableCarrier';
	}
}

/** A pg-boss carrier in an app that declares no database to host it. */
export class BrokerNeedsADatabase extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' is carried by pg-boss, which lives in the database the app ` +
				`declares — and this app declares none. Declare a database, or set ` +
				`services.events to a backend that brings its own broker.`,
		);
		this.name = 'BrokerNeedsADatabase';
	}
}

/** A bucket on a backend this target has no primitive for. */
export class UnprovisionableBucket extends Error {
	constructor(
		readonly id: string,
		readonly backend: string,
	) {
		super(
			`'${id}' is stored on '${backend}', which this target cannot ` +
				`provision: an S3 or R2 bucket belongs to an account this deploy ` +
				`does not hold, the way an API key does. Set services.storage to ` +
				`'minio' to run one on the box, or supply the bucket's URL.`,
		);
		this.name = 'UnprovisionableBucket';
	}
}
