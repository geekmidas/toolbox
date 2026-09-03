/**
 * The URLs a reconciled stage injects.
 *
 * One `<NAME>_URL` per construct, and the protocol picks the driver. This is the
 * seam between the target that writes a URL and the client that parses it, so
 * every component of it is read off the resource — never inherited from ambient
 * environment. A bucket can live in a different region than the function reading
 * it, and `AWS_REGION` in a Lambda is the *function's* region, so a URL that
 * omits `?region=` breaks cross-region silently at runtime.
 *
 * Locally that self-containment is what lets the port be whatever was free: the
 * app reads `ORDERS_URL` and never sees a host or a port.
 */

import { createHash } from 'node:crypto';
import { ownerRole, readerRole } from '@geekmidas/db/pg/roles';
import { cacheTable, cookieDomain, provideKey } from '@geekmidas/manifest';
import { primaryPortKey } from './containers';
import { PgBossNeedsDatabase, type Plan, type PlannedResource } from './plan';
import type { PortAssignments } from './ports';

/**
 * The credential local containers are brought up with.
 *
 * The design's `roles: false` case — both URLs fall back to the cluster's master
 * credential. A deliberate downgrade, not a default: it holds until the role DDL
 * lands in `@geekmidas/db`, at which point the runtime role's URL replaces this
 * and the owner URL stops being reachable from any manifest edge.
 */
const LOCAL_USER = 'geekmidas';

/** The host containers are published on. */
const LOCAL_HOST = 'localhost';

/** The region local buckets claim, so the client has one to sign with. */
const LOCAL_REGION = 'us-east-1';

/**
 * The credentials the S3 client resolves for MinIO.
 *
 * An `s3://` URL deliberately carries none: deployed, the SDK reads them from
 * the execution role, so a URL that embedded a key would be one more thing to
 * rotate and one more thing to leak into a log. Locally there is no role, and
 * the same chain reads these — which is why they are injected beside the URL
 * rather than written into it.
 */
const STORAGE_CREDENTIALS: Readonly<Record<string, string>> = {
	AWS_ACCESS_KEY_ID: LOCAL_USER,
	AWS_SECRET_ACCESS_KEY: LOCAL_USER,
	AWS_REGION: LOCAL_REGION,
};

/** The token the local cache proxy accepts. Matches the compose definition. */
const LOCAL_TOKEN = 'geekmidas';

/** The schema pg-boss keeps its tables in, inside the declared database. */
const PGBOSS_SCHEMA = 'pgboss';

/** The exchange every local topic and queue shares on RabbitMQ. */
const RABBITMQ_EXCHANGE = 'geekmidas.events';

export interface EnvOptions {
	/** Assigned ports, keyed by port key. */
	ports: PortAssignments;
	/**
	 * The project, which seeds any secret this stage derives.
	 *
	 * Derived rather than random so it survives a restart -- a signing key that
	 * changed on every `gkm dev` would invalidate every session you were in the
	 * middle of -- and seeded by the project so two checkouts do not share one.
	 */
	project?: string;
	/**
	 * Where each address-owning construct answers, keyed by id — surfaces and
	 * sites, e.g. `{ Api: 'http://localhost:3000', Console: 'http://localhost:5173' }`.
	 *
	 * Not container addresses: `gkm dev` assigns these, which is why they arrive
	 * here rather than being read off a published port. Keyed by id rather than
	 * being one `surface` string because there is more than one address in a
	 * workspace and the difference between them is exactly what CORS is about.
	 */
	addresses?: Readonly<Record<string, string>>;
	/**
	 * The domain mail is sent from locally.
	 *
	 * Stage config, exactly as it is deployed — the difference is only that here
	 * nobody had to verify it.
	 */
	mailFrom?: string;
}

/**
 * Every env key a reconciled plan resolves, and its value.
 *
 * Keys come from the declaration rather than being re-derived, so what the build
 * publishes and what the app reads cannot drift.
 */
export function envFor(
	plan: Plan,
	options: EnvOptions,
): Record<string, string> {
	const env: Record<string, string> = {};

	for (const resource of plan.resources) {
		const url = urlFor(
			resource,
			plan,
			options.ports,
			options.project ?? '',
			options.addresses,
		);

		// A surface carries the origins its callers may come from, and they are
		// its inbound edges — nothing more. Better Auth's CSRF check applies to
		// every caller and not only to browsers, so a sibling service calling it
		// is rejected unless its origin is listed; that this list is now the
		// graph rather than every app the workspace happens to run is what makes
		// it the same list deployed, where no workspace is watching.
		if (resource.kind === 'rest-api') {
			Object.assign(env, surfaceEnv(resource, url, options.addresses));
		}
		if (url) env[resource.envKey] = url;

		// A database owns a second key, and it is deliberately not in `provides`:
		// the owner URL is what a migrator connects with, so no edge in any
		// manifest can name it and nothing can be granted DDL rights by mistake.
		// `gkm exec` injects it; a handler never sees it.
		if (isDatabase(resource.kind) && resource.roles !== false) {
			const owner = ownerUrl(
				resource,
				plan,
				options.ports,
				options.project ?? '',
			);
			if (owner) env[provideKey(resource.id, 'ownerUrl')] = owner;
		}

		// Mail owns a second key. It is the sending identity, which is the one
		// thing about mail that differs per stage — so it travels with the URL
		// rather than being written into the construct.
		if (resource.kind === 'email' && url) {
			env[provideKey(resource.id, 'from')] =
				options.mailFrom ?? `noreply@${LOCAL_HOST}`;
		}
	}

	// After the loop, and deliberately: a site's keys are renames of values the
	// constructs it depends on resolved, so every source has to exist before any
	// of them can be read. Doing it inline would make the result depend on the
	// order the manifest happened to be keyed in.
	Object.assign(env, publicEnv(plan, env));

	Object.assign(env, brokerEnv(plan, options.ports));

	// Only once a bucket actually resolved: an unresolvable plan resolves
	// nothing, and credentials for a container that is not running are noise.
	if (plan.resources.some((r) => r.kind === 'objects' && env[r.envKey])) {
		Object.assign(env, STORAGE_CREDENTIALS);
	}

	return env;
}

/**
 * The values a site's bundler inlines, under the names it inlines them by.
 *
 * A rename and nothing more. `API_URL` was resolved once, by the same code that
 * resolved it for the server; a site reads the same value under `VITE_API_URL`
 * because that prefix is how its bundler is told to ship it. Nothing is derived
 * twice, so a site and its API cannot come to disagree about where the API is.
 *
 * A source that resolved to nothing is skipped rather than written empty: an
 * inlined empty string is a frontend that builds and then fails at runtime
 * against `http:///`, where a missing variable fails at build with the name of
 * the thing that is missing.
 */
function publicEnv(
	plan: Plan,
	resolved: Record<string, string>,
): Record<string, string> {
	const env: Record<string, string> = {};

	for (const resource of plan.resources) {
		for (const [key, source] of Object.entries(resource.publicEnv ?? {})) {
			const value = resolved[source];
			if (value) env[key] = value;
		}
	}

	return env;
}

/**
 * What a surface publishes beyond its own address: who may call it, and where
 * a cookie set by it is readable.
 *
 * Both are read off the same list — the constructs that declared an edge to
 * this surface — which is why neither appears in application code. A surface
 * that listed its own callers would be edited every time something new called
 * it, and the thing being edited is already recorded in the graph.
 *
 * An empty origin list is written, and a surface with no address writes nothing
 * at all. The two cases look alike and are not: "nothing depends on this yet" is
 * a real state a target should publish, while "this surface has no address here"
 * means it is not running in this stage, and keys belong with the address they
 * describe.
 */
function surfaceEnv(
	resource: PlannedResource,
	url: string | undefined,
	addresses: Readonly<Record<string, string>> = {},
): Record<string, string> {
	if (!url) return {};

	const origins = [
		...new Set(
			(resource.callers ?? [])
				.map((caller) => addresses[caller])
				.filter((address): address is string => Boolean(address))
				.map(originOf)
				.filter((origin): origin is string => Boolean(origin)),
		),
	].sort();

	// Its own address belongs in the cookie derivation but not in the origin
	// list: a surface does not need permission to call itself, and adding it
	// would make every surface trust every other one that shares a port.
	const domain = cookieDomain([url, ...origins]);

	return {
		[provideKey(resource.id, 'trustedOrigins')]: origins.join(','),
		...(domain ? { [provideKey(resource.id, 'cookieDomain')]: domain } : {}),
	};
}

/** An address reduced to the origin a browser compares against. */
function originOf(address: string): string | undefined {
	try {
		return new URL(address).origin;
	} catch {
		return undefined;
	}
}

/**
 * The runtime role of whatever a derived node hangs off.
 *
 * A reader's parent may itself be a schema tenant, so this follows `of` by one
 * hop rather than assuming the cluster — the reader of a tenant reads that
 * tenant's schema, not the database's.
 */
function parentRole(resource: PlannedResource, plan: Plan): string {
	const parent = plan.resources.find((r) => r.id === resource.of);

	return parent ? localRole(parent) : resource.name;
}

/** Whether a kind connects to Postgres and therefore has an owner role. */
function isDatabase(kind: PlannedResource['kind']): boolean {
	return kind === 'database' || kind === 'database-schema';
}

/**
 * The URL a migrator connects with — the owner role, which can create, alter
 * and drop.
 *
 * Never in `provides`, which is the whole point. A handler that could reach this
 * could `DROP TABLE`, and the security property the role split exists for is
 * that it cannot: the value is injected by `gkm exec` for the migrate step and
 * by nothing else.
 */
function ownerUrl(
	resource: PlannedResource,
	plan: Plan,
	ports: PortAssignments,
	project: string,
): string | undefined {
	if (!resource.container) return undefined;

	const port = ports[primaryPortKey(resource.container)];
	if (port === undefined) return undefined;

	const owner = ownerRole(localRole(resource));

	return postgres(port, rootDatabase(resource, plan), {
		user: owner,
		password: localRolePassword(project, plan, owner),
	});
}

/**
 * The shared broker keys, when anything is published or consumed.
 *
 * A queue's own key is the producer's. These two are the *connection* itself,
 * which locally is one broker for every queue and topic in the project: the
 * generated pollers open a single connection and subscribe each worker by name
 * on it. Deployed there is no such thing — a Lambda is handed its own event
 * source — so this pair exists for the local target and says so.
 */
function brokerEnv(plan: Plan, ports: PortAssignments): Record<string, string> {
	const carrier = plan.resources.find(
		(r) => r.kind === 'queue' || r.kind === 'topic',
	);
	if (!carrier) return {};

	const publisher = urlFor(carrier, plan, ports, '');
	if (!publisher) return {};

	return {
		EVENT_PUBLISHER_CONNECTION_STRING: publisher,
		// One connection for both directions everywhere except SNS, where the
		// thing you publish to and the thing you poll are different services.
		EVENT_SUBSCRIBER_CONNECTION_STRING:
			plan.events === 'sns' ? publisher.replace(/^sns:/, 'sqs:') : publisher,
	};
}

/**
 * The URL for one planned resource.
 *
 * Every part of it comes from the resource and the port it was published on.
 */
function urlFor(
	resource: PlannedResource,
	plan: Plan,
	ports: PortAssignments,
	project: string,
	addresses: Readonly<Record<string, string>> = {},
): string | undefined {
	// A secret has no address, so there is no port to wait for.
	if (resource.kind === 'secret') return localSecret(project, plan, resource);

	// A credential resolves to nothing here, deliberately. A secret is derived
	// because the platform owns it; a credential was issued by a third party, so
	// inventing a value would produce a Stripe key that is not a Stripe key and
	// fail at the first call rather than at the first read. It comes from
	// `gkm secrets` or `.env` like any other supplied value, and the construct's
	// own schema is what reports it missing.
	if (resource.kind === 'credential') return undefined;

	// A surface answers on the app's own port, and a site on its dev server's —
	// both assigned by the workspace, neither published by a container.
	if (resource.kind === 'rest-api' || resource.kind === 'site') {
		return addresses[resource.id];
	}

	if (!resource.container) return undefined;

	const port = ports[primaryPortKey(resource.container)];
	if (port === undefined) return undefined;

	switch (resource.kind) {
		case 'database':
		case 'database-schema':
		case 'database-reader': {
			// A tenant and a reader both live in the *parent's* database; what
			// separates them is the role's grants and the `search_path` pinned on
			// that role, never a database of their own.
			const database = rootDatabase(resource, plan);

			// The runtime role, which can read and write rows and create nothing.
			// `search_path` is pinned on the role by the DDL rather than carried
			// here, so a connection string cannot forget it — and forgetting it
			// looks like an empty database rather than an error.
			//
			// `roles: false` is the documented downgrade: both URLs fall back to
			// the cluster's master credential, and the schema goes back into the
			// URL because there is no role to pin it on.
			if (resource.roles === false) {
				const schema = schemaOf(resource, plan);

				return schema
					? `${postgres(port, database)}?search_path=${schema}`
					: postgres(port, database);
			}

			// A reader connects as the read-only role on its parent, not as a role
			// of its own: read-only is enforced by the grants, which is what makes
			// falling back to the writer's endpoint safe where no replica exists.
			const role =
				resource.kind === 'database-reader'
					? readerRole(parentRole(resource, plan))
					: localRole(resource);

			return postgres(port, database, {
				user: role,
				password: localRolePassword(project, plan, role),
			});
		}

		case 'email':
			// The same scheme the deployed target writes; only host and credentials
			// differ, which is what lets the client never branch on provider.
			return `smtp://${LOCAL_HOST}:${port}`;

		case 'objects':
			// `?endpoint=` is what points the same S3 client at MinIO — the client
			// is identical, only the URL differs. Path-style addressing goes with
			// it: virtual-host style resolves `bucket.localhost`, which is not
			// MinIO and not anything.
			return `s3://${resource.name}?region=${LOCAL_REGION}&endpoint=http://${LOCAL_HOST}:${port}&forcePathStyle=true`;

		case 'file-server': {
			// Path style, not the deployed shape, and deliberately so. MinIO's
			// virtual-host mode reads the leading label *as the bucket name*, so
			// it only produces the CDN shape when the server's id and the
			// bucket's agree — and never at all for a server fronting two
			// buckets. The honest local answer is the address that works;
			// producing the deployed shape needs a small proxy in front of MinIO,
			// which is additive and changes no construct API. Note that an AWS
			// emulator does not supply it: CloudFront emulation is control plane
			// only, and what is needed here is the data plane.
			const origin = plan.resources.find((r) => r.id === resource.of);
			if (!origin) return undefined;

			return `http://${LOCAL_HOST}:${port}/${origin.name}`;
		}

		case 'cache':
			// The scheme is the backend, and the backend is the same one deployed —
			// which is what lets a driver registered at build time match the URL
			// resolved at run time.
			//
			// A cache in a database has no address of its own: no second host and
			// no second credential, just its parent's URL. Reached by following
			// `of` and nothing else — `planFor` has already resolved a
			// `cache: 'db'` backend into that edge, so there is one way a cache
			// lands in a database and one way to find out.
			if (resource.of) {
				const parent = plan.resources.find((r) => r.id === resource.of);
				const url = parent
					? urlFor(parent, plan, ports, project, addresses)
					: undefined;

				// The parent's address plus the one thing that distinguishes this
				// cache from another in the same database: its table. Two caches on
				// one database resolve the same connection string, so without it a
				// client built from the URL cannot tell them apart.
				return url
					? withTable(url, resource.table ?? cacheTable(resource.id))
					: undefined;
			}

			switch (plan.cache) {
				case 'elasticache':
					// The wire protocol, unauthenticated locally. Deployed it is
					// `rediss://` inside a VPC; the client is the same either way.
					return `redis://${LOCAL_HOST}:${port}`;

				default:
					// The token in the userinfo, because an address and the credential
					// that opens it are one fact. Deployed the scheme is https and the
					// host is the provider's; nothing else differs.
					return `http://:${LOCAL_TOKEN}@${LOCAL_HOST}:${port}`;
			}

		case 'queue':
		case 'topic':
			return broker(plan, port);

		default:
			return undefined;
	}
}

/**
 * The producer's connection string, composed from the backend the plan chose.
 *
 * The protocol is what picks the transport, so a producer never branches: the
 * same `.publish()` reaches pg-boss here and SQS deployed because the string it
 * was handed said so.
 */
function broker(plan: Plan, port: number): string {
	switch (plan.events) {
		case 'pgboss': {
			// A schema tenant of the database the app already declared, which is
			// why nothing here invents a Postgres of its own.
			const database = plan.resources.find((r) => r.kind === 'database');
			if (!database) throw new PgBossNeedsDatabase([]);

			return `pgboss://${LOCAL_USER}:${LOCAL_USER}@${LOCAL_HOST}:${port}/${database.name}?schema=${PGBOSS_SCHEMA}`;
		}

		case 'rabbitmq':
			// The exchange is declared by whichever client connects first, so
			// naming it here is the whole of the setup.
			return `rabbitmq://${LOCAL_USER}:${LOCAL_USER}@${LOCAL_HOST}:${port}?exchange=${RABBITMQ_EXCHANGE}`;

		case 'sns':
			// An SNS URL carries the ARN of a topic that has to exist first, so
			// this needs a provisioning step LocalStack has not been given yet.
			// Failing here names the gap; composing a URL without the ARN would
			// fail at the first publish instead.
			throw new UnprovisionedEventsBackend('sns');
	}
}

/** A local Postgres URL, master credential and all. */
function postgres(
	port: number,
	database: string,
	credential: { user: string; password: string } = {
		user: LOCAL_USER,
		password: LOCAL_USER,
	},
): string {
	return `postgres://${credential.user}:${credential.password}@${LOCAL_HOST}:${port}/${database}`;
}

/**
 * The role a handler connects as, for one database or tenant.
 *
 * The construct's id, lowercased and stage-scoped exactly as its database or
 * schema is — so `Orders` in the `test` stage connects as `orders_test`, and two
 * stages sharing one cluster cannot share a credential. Roles are cluster-scoped
 * in Postgres, which is why the suffix is not optional here the way it is for a
 * schema.
 */
export function localRole(resource: PlannedResource): string {
	return resource.name;
}

/**
 * The password for a derived local role.
 *
 * Derived rather than random, for the same reason the local secret is: a
 * password that changed on every `gkm dev` would lock a developer out of the
 * data they had a moment ago. Seeded by the project so two checkouts do not
 * share one, and by the stage so `test` and `development` do not.
 *
 * It is a *local* credential by construction — the cluster is on loopback and
 * the seed is a checkout path — and no deployed target uses this function.
 */
export function localRolePassword(
	project: string,
	plan: Plan,
	role: string,
): string {
	return createHash('sha256')
		.update(`${project}:${plan.stage}:role:${role}`)
		.digest('base64url')
		.slice(0, 32);
}

/**
 * A cache's address: its database's URL, carrying the table it reads.
 *
 * Appended rather than kept beside the URL as a second key, for the reason the
 * design gives everywhere else — an address and what it opens are one fact, and
 * two keys are one more thing to keep in step.
 */
function withTable(url: string, table: string): string {
	const parsed = new URL(url);
	parsed.searchParams.set('table', table);

	return parsed.toString();
}

/**
 * The physical database a derived resource lives in.
 *
 * Walks `of` to the top rather than reading the immediate parent, because a
 * reader's parent may itself be a schema tenant — two hops from the database
 * that actually exists.
 */
export function rootDatabase(resource: PlannedResource, plan: Plan): string {
	const byId = new Map(plan.resources.map((r) => [r.id, r]));
	let current = resource;

	while (current.of) {
		const parent = byId.get(current.of);
		if (!parent) break;
		current = parent;
	}

	return current.name;
}

/** The schema a derived resource puts on its search path, if it has one. */
function schemaOf(resource: PlannedResource, plan: Plan): string | undefined {
	const byId = new Map(plan.resources.map((r) => [r.id, r]));
	let current: PlannedResource | undefined = resource;

	// A reader has no schema of its own; it reads whatever its parent addresses.
	while (current) {
		if (current.kind === 'database-schema') return current.schema;
		current = current.of ? byId.get(current.of) : undefined;
	}

	return undefined;
}

/**
 * A backend whose local addresses cannot be derived yet.
 *
 * SNS and SQS are addressed by ARN, which means the topic and queue have to be
 * created in LocalStack before a URL can name them. Until that provisioning
 * lands, saying so is better than handing out a string that fails on first use.
 */
export class UnprovisionedEventsBackend extends Error {
	constructor(readonly backend: string) {
		super(
			`The local target cannot derive addresses for '${backend}' yet — its ` +
				`topics and queues are named by ARN, which nothing creates locally. ` +
				`Use 'pgboss' (the default) or 'rabbitmq' for local development.`,
		);
		this.name = 'UnprovisionedEventsBackend';
	}
}

/**
 * The value a secret resolves to locally.
 *
 * A hash of what identifies it, so it is stable, distinct per project, stage
 * and construct, and never written to disk as a literal. Deployed this is the
 * one kind whose value does *not* come from here — a secret manager generates
 * it once and the target reads it back.
 */
function localSecret(
	project: string,
	plan: Plan,
	resource: PlannedResource,
): string {
	return createHash('sha256')
		.update(`${project}:${plan.stage}:${resource.id}`)
		.digest('base64url')
		.slice(0, 43);
}
