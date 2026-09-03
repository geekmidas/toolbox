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
 * What a resource is called *in the provider*, as opposed to inside Postgres.
 *
 * Two different names, and conflating them was the mistake worth naming. A
 * database's Postgres identifier is `kitchensink_prod` — snake, because every
 * identifier that touches it is — while a provider resource is kebab and
 * scoped, so two stages or two apps sharing an account cannot collide.
 *
 * `cloudName` is that second rule, and it is the one the AWS target already
 * uses. Deriving a Dokploy name from `resourceName` and swapping underscores,
 * which is what this did first, invents a third convention that agrees with
 * neither.
 *
 * The kind suffix is the one thing added on top, and only because Dokploy needs
 * it: AWS resources are typed by service, so `prod-toolbox-kitchen-sink` is
 * unambiguous there. A Dokploy project is one flat list, where the application
 * and the database it talks to would otherwise be two entries with the same
 * name.
 */
export function serviceName(
	scope: { stage: string; app: string },
	id: string,
	kind: DeclarationKind,
): string {
	return `${cloudName(scope, id)}-${SERVICE_KIND[kind] ?? kind}`;
}

/** What each kind runs as, in the words the thing itself uses. */
const SERVICE_KIND: Partial<Record<DeclarationKind, string>> = {
	database: 'postgres',
	objects: 'minio',
	email: 'smtp',
};

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
				declaration.kind,
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
