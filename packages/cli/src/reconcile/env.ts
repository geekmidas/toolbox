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

import { provideKey } from '@geekmidas/manifest';
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

/** The schema pg-boss keeps its tables in, inside the declared database. */
const PGBOSS_SCHEMA = 'pgboss';

/** The exchange every local topic and queue shares on RabbitMQ. */
const RABBITMQ_EXCHANGE = 'geekmidas.events';

export interface EnvOptions {
	/** Assigned ports, keyed by port key. */
	ports: PortAssignments;
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
		const url = urlFor(resource, plan, options.ports);
		if (url) env[resource.envKey] = url;

		// Mail owns a second key. It is the sending identity, which is the one
		// thing about mail that differs per stage — so it travels with the URL
		// rather than being written into the construct.
		if (resource.kind === 'email' && url) {
			env[provideKey(resource.id, 'from')] =
				options.mailFrom ?? `noreply@${LOCAL_HOST}`;
		}
	}

	Object.assign(env, brokerEnv(plan, options.ports));

	// Only once a bucket actually resolved: an unresolvable plan resolves
	// nothing, and credentials for a container that is not running are noise.
	if (plan.resources.some((r) => r.kind === 'objects' && env[r.envKey])) {
		Object.assign(env, STORAGE_CREDENTIALS);
	}

	return env;
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

	const publisher = urlFor(carrier, plan, ports);
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
): string | undefined {
	const port = ports[primaryPortKey(resource.container)];
	if (port === undefined) return undefined;

	switch (resource.kind) {
		case 'database':
			return postgres(port, resource.name);

		case 'database-schema':
		case 'database-reader': {
			// A tenant and a reader both live in the *parent's* database; what
			// separates them is the schema on the search path and the role's grants,
			// never a database of their own.
			const database = rootDatabase(resource, plan);
			const schema = schemaOf(resource, plan);

			return schema
				? `${postgres(port, database)}?search_path=${schema}`
				: postgres(port, database);
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
function postgres(port: number, database: string): string {
	return `postgres://${LOCAL_USER}:${LOCAL_USER}@${LOCAL_HOST}:${port}/${database}`;
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
