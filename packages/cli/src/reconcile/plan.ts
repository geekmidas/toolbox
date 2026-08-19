/**
 * The reconcile plan — what a manifest wants to exist, for one stage.
 *
 * Pure. Turning the plan into running containers and provisioned resources is
 * the applier's job; deciding *what* should exist is this, so the decisions can
 * be asserted as data rather than by starting Docker.
 *
 * One plan serves every stage. `gkm dev` reconciles `development` and `gkm test`
 * reconciles `test`; they differ only in what the resources are called, never in
 * what infrastructure exists. Roles are cluster-scoped in Postgres while grants
 * are per-object, so one container and one role pair serve both.
 */

import {
	type ConstructManifest,
	type Declaration,
	type DeclarationKind,
	provideKey,
} from '@geekmidas/manifest';
import type { EventsBackend } from '../types';

/** The stage whose resources carry no suffix. */
export const DEFAULT_STAGE = 'development';

/**
 * Which container serves a kind.
 *
 * Derived kinds map to the same container as their parent — a schema tenant
 * lives in its parent's Postgres — so the set is deduplicated rather than
 * counted.
 */
const CONTAINERS: Partial<Record<DeclarationKind, string>> = {
	database: 'postgres',
	'database-reader': 'postgres',
	'database-schema': 'postgres',
	objects: 'minio',
	email: 'mailpit',
};

/**
 * Which kinds provision something *inside* their container.
 *
 * A database creates a database, a bucket creates a bucket; mail creates
 * nothing — Mailpit accepts whatever is sent to it and has no per-stage object
 * to name. Both still appear in the plan, because both still resolve a URL; the
 * flag is the difference between "must be running" and "must be created".
 */
const PROVISIONS: Partial<Record<DeclarationKind, true>> = {
	database: true,
	'database-reader': true,
	'database-schema': true,
	objects: true,
};

/**
 * The container each events backend needs, where it needs one of its own.
 *
 * `pgboss` is deliberately absent rather than mapped to `postgres`: it is a
 * schema tenant in a database the manifest already declares, so mapping it here
 * would start a Postgres for a project that declared no database at all.
 *
 * This one comes from config rather than from a declaration because there are
 * no `topic` or `queue` kinds yet. When they land the mapping moves to
 * {@link CONTAINERS} keyed by kind, and this constant goes with them.
 */
const EVENT_CONTAINERS: Partial<Record<EventsBackend, string>> = {
	sns: 'localstack',
	rabbitmq: 'rabbitmq',
};

/**
 * How a resource of each kind separates its stage suffix.
 *
 * Postgres identifiers are snake_case and a hyphen would need quoting
 * everywhere; buckets and queues are kebab and disallow underscores in some
 * providers. The suffix is the same word either way.
 */
const SEPARATORS: Partial<Record<DeclarationKind, string>> = {
	database: '_',
	'database-reader': '_',
	'database-schema': '_',
	objects: '-',
};

/** One thing that must exist, and what it is called in this stage. */
export interface PlannedResource {
	/** The construct's canonical id, e.g. `Orders`. */
	id: string;
	kind: DeclarationKind;
	/** The container that serves it, e.g. `postgres`. */
	container: string;
	/** The stage-scoped name, e.g. `orders_test`. */
	name: string;
	/** The env key it resolves onto anything depending on it. */
	envKey: string;
	/** The parent it derives from, for kinds that provision nothing themselves. */
	of?: string;
	/**
	 * Whether anything has to be created inside the container for this.
	 *
	 * False for mail: Mailpit takes whatever is sent to it. The applier skips
	 * these; the env writer still resolves their URL.
	 */
	provisions: boolean;
	/** The schema a tenant pins on its roles' `search_path`. */
	schema?: string;
}

export interface Plan {
	stage: string;
	/** Containers to start, deduplicated. */
	containers: string[];
	/**
	 * Everything the stage resolves a URL for, parents before children.
	 *
	 * Not all of it is provisioned — see `PlannedResource.provisions`.
	 */
	resources: PlannedResource[];
}

/** What the plan needs that the manifest cannot tell it. */
export interface PlanOptions {
	/**
	 * The events backend, which selects a container of its own for everything
	 * except pg-boss.
	 *
	 * Config rather than declaration only until `topic` and `queue` are kinds —
	 * see {@link EVENT_CONTAINERS}.
	 */
	events?: EventsBackend;
	/**
	 * Containers no construct implies — the escape hatch, and the whole of what
	 * the workspace `services:` block becomes.
	 *
	 * A list of exceptions rather than a list you maintain: everything a
	 * construct implies is already in the plan before this is read.
	 */
	extraContainers?: readonly string[];
}

/**
 * The stage-scoped name for a resource.
 *
 * The default stage carries no suffix, so `gkm dev` keeps using `orders` and a
 * developer's psql history, saved connections, and muscle memory survive this
 * change. Every other stage is suffixed.
 */
export function resourceName(
	id: string,
	kind: DeclarationKind,
	stage: string,
): string {
	const base = id.toLowerCase();
	if (stage === DEFAULT_STAGE) return base;

	return `${base}${SEPARATORS[kind] ?? '-'}${stage}`;
}

/** The container a kind needs, or `undefined` if it needs none. */
export function containerFor(kind: DeclarationKind): string | undefined {
	return CONTAINERS[kind];
}

/**
 * Build the plan for a manifest and stage.
 *
 * `order` is the caller's provisioning order — parents before children — which
 * `provisionOrder` produces from the manifest. Passing it in keeps this
 * function free of the traversal and makes the ordering assertable on its own.
 */
export function planFor(
	manifest: ConstructManifest,
	stage: string,
	order: readonly string[],
	options: PlanOptions = {},
): Plan {
	const containers = new Set<string>();
	const resources: PlannedResource[] = [];

	for (const id of order) {
		const declaration: Declaration | undefined = manifest[id];
		if (!declaration) continue;

		const container = containerFor(declaration.kind);
		if (!container) continue;

		containers.add(container);

		resources.push({
			id,
			kind: declaration.kind,
			container,
			name: resourceName(id, declaration.kind, stage),
			envKey: provideKey(id, 'url'),
			provisions: PROVISIONS[declaration.kind] === true,
			...('of' in declaration ? { of: declaration.of } : {}),
			...('schema' in declaration && declaration.schema
				? { schema: declaration.schema }
				: {}),
		});
	}

	const events = options.events && EVENT_CONTAINERS[options.events];
	if (events) containers.add(events);

	for (const extra of options.extraContainers ?? []) containers.add(extra);

	return { stage, containers: [...containers], resources };
}
