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
import type { Plan, PlannedResource } from './plan';
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

	return env;
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
			// is identical, only the URL differs.
			return `s3://${resource.name}?region=us-east-1&endpoint=http://${LOCAL_HOST}:${port}`;

		default:
			return undefined;
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
