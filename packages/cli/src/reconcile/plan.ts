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
	environmentCase,
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
	// The proxy, not the Redis behind it: the client speaks HTTP with a token
	// wherever it runs, which is what makes dev and prod the same client.
	cache: 'redis-http',
};

/**
 * Kinds that resolve a value without anything running.
 *
 * A secret is the case: it has no address, so there is nothing to start and
 * nothing to connect to — but it still appears in the plan, because the target
 * still has to resolve it.
 */
const CONTAINERLESS: Partial<Record<DeclarationKind, true>> = {
	secret: true,
	// A surface answers on the app's own port. It is the first kind whose
	// address belongs to something gkm starts rather than something Docker does.
	'rest-api': true,
};

/**
 * Containers that cannot run alone.
 *
 * The one case is the cache: `serverless-redis-http` is a proxy and needs the
 * Redis it proxies. Kept here rather than in the compose definition so the plan
 * -- which is what decides what must be running -- still names everything.
 */
const REQUIRES: Readonly<Record<string, readonly string[]>> = {
	'redis-http': ['redis'],
};

/**
 * The role each kind's one key plays, where it is not a URL.
 *
 * The twin of `ProvidesByKind` in `@geekmidas/manifest`: that is what a
 * construct declares, this is what the local target resolves, and both derive
 * the key from the same `provideKey` so they cannot disagree.
 */
const ROLES: Partial<Record<DeclarationKind, string>> = {
	queue: 'publisherConnectionString',
	topic: 'publisherConnectionString',
};

/** The kinds whose container is the events backend's rather than their own. */
const EVENT_KINDS: Partial<Record<DeclarationKind, true>> = {
	queue: true,
	topic: true,
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
// Queues and topics are absent deliberately: pg-boss creates its own schema and
// tables on first connect, and a RabbitMQ exchange is declared by the client
// that binds to it. Both still appear in the plan, because both still resolve a
// connection string.

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

/** The backend a project gets when it declares queues or topics and says nothing. */
export const DEFAULT_EVENTS: EventsBackend = 'pgboss';

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
	/** The container that serves it, e.g. `postgres`. Absent for a secret. */
	container?: string;
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
	/**
	 * The events backend this plan was built for.
	 *
	 * Carried on the plan rather than passed alongside it, because everything
	 * downstream that composes a connection string needs it and reading it off
	 * the plan is what keeps the two from disagreeing.
	 */
	events: EventsBackend;
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

/**
 * The container a kind needs, or `undefined` if it needs none.
 *
 * Queues and topics have no container of their own — they live in whichever
 * broker the project selected, which is why the backend is an argument here
 * rather than a second pass that adds containers after the fact.
 */
export function containerFor(
	kind: DeclarationKind,
	events: EventsBackend = DEFAULT_EVENTS,
): string | undefined {
	if (EVENT_KINDS[kind]) {
		// pg-boss is deliberately absent from EVENT_CONTAINERS: it is a schema
		// tenant in a database the manifest already declares, so its container is
		// that database's.
		return EVENT_CONTAINERS[events] ?? CONTAINERS.database;
	}

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

	const events = options.events ?? DEFAULT_EVENTS;

	for (const id of order) {
		const declaration: Declaration | undefined = manifest[id];
		if (!declaration) continue;

		const container = containerFor(declaration.kind, events);
		if (!container && !CONTAINERLESS[declaration.kind]) continue;

		if (container) {
			containers.add(container);
			for (const required of REQUIRES[container] ?? [])
				containers.add(required);
		}

		resources.push({
			id,
			kind: declaration.kind,
			...(container ? { container } : {}),
			name: resourceName(id, declaration.kind, stage),
			// A secret's name *is* its key — there is no role to qualify, and
			// `AUTH_SECRET_SECRET` is what qualifying it would produce.
			envKey:
				declaration.kind === 'secret'
					? environmentCase(id)
					: provideKey(id, ROLES[declaration.kind] ?? 'url'),
			provisions: PROVISIONS[declaration.kind] === true,
			...('of' in declaration ? { of: declaration.of } : {}),
			...('schema' in declaration && declaration.schema
				? { schema: declaration.schema }
				: {}),
		});
	}

	for (const extra of options.extraContainers ?? []) containers.add(extra);

	// pg-boss lives in a declared database. Without one there is nothing for it
	// to live in, and starting a Postgres to hold only a queue would be the
	// container this design refuses to invent.
	if (
		events === 'pgboss' &&
		resources.some((r) => EVENT_KINDS[r.kind]) &&
		!resources.some((r) => r.kind === 'database')
	) {
		throw new PgBossNeedsDatabase(
			resources.filter((r) => EVENT_KINDS[r.kind]).map((r) => r.id),
		);
	}

	return { stage, events, containers: [...containers], resources };
}

/**
 * Queues or topics were declared with pg-boss and no database to hold them.
 *
 * Not a reconcile failure but a manifest one: the fix is a line of application
 * code either way — declare a database, or select a backend that brings its own
 * broker.
 */
export class PgBossNeedsDatabase extends Error {
	constructor(readonly ids: readonly string[]) {
		super(
			`pg-boss keeps its queues in a declared database, and none was declared. ` +
				`Declare one, or set services.events to 'rabbitmq' or 'sns'. ` +
				`Queues and topics affected: ${ids.join(', ')}.`,
		);
		this.name = 'PgBossNeedsDatabase';
	}
}
