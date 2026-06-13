/**
 * Deployment manifest types — the build output of `gkm build` that enumerates a
 * project's deployable units (routes, functions, crons, subscribers, queues)
 * with the metadata an infrastructure layer needs to provision them.
 *
 * `gkm build` writes a single TypeScript module per provider
 * (`<out>/manifest/aws.ts`) of the form:
 *
 * ```ts
 * export const manifest = { routes: [...], functions: [...], ... } as const;
 * export type Route = (typeof manifest.routes)[number];
 * // ...derived types
 * ```
 *
 * This is the dependency-free data contract shared between the producer
 * (`@geekmidas/cli`) and consumers (e.g. `@geekmidas/cloud/sst`'s `fromManifest`
 * integrators).
 */

/**
 * A manifest field is either a flat list or, when the build is partitioned
 * (e.g. by authorizer), an object keyed by partition name. Readonly-tolerant so
 * the `as const` generated manifest assigns cleanly.
 */
export type ManifestField<T> =
	| readonly T[]
	| Readonly<Record<string, readonly T[]>>;

/** Flatten a manifest field (array or partitioned) into a plain array. */
export function flattenManifestField<T>(
	field: ManifestField<T> | undefined,
): T[] {
	if (!field) return [];
	return Array.isArray(field)
		? [...field]
		: Object.values(field as Record<string, readonly T[]>).flat();
}

/** A single HTTP route. */
export interface RouteInfo {
	/** Route path, e.g. `/users/{id}`. */
	path: string;
	/** HTTP method, e.g. `GET`. */
	method: string;
	/** Bundled handler entrypoint. */
	handler: string;
	timeout?: number;
	memorySize?: number;
	/** Required environment variables (a trailing `?` marks an optional var). */
	environment?: readonly string[];
	/** Authorizer name: `none`, `iam`, or a declared authorizer. */
	authorizer: string;
}

/** A standalone Lambda function. */
export interface FunctionInfo {
	name: string;
	handler: string;
	timeout?: number;
	memorySize?: number;
	environment?: readonly string[];
}

/** A scheduled (cron) function. */
export interface CronInfo {
	name: string;
	handler: string;
	/** Schedule expression, e.g. `rate(1 day)` or `cron(0 12 * * ? *)`. */
	schedule: string;
	timeout?: number;
	memorySize?: number;
	environment?: readonly string[];
}

/** An event subscriber function (topic/queue resolved by `transport`). */
export interface SubscriberInfo {
	name: string;
	handler: string;
	subscribedEvents: readonly string[];
	/** Delivery transport — `topic` (SNS fan-out) or `queue` (SQS). */
	transport?: 'topic' | 'queue';
	timeout?: number;
	memorySize?: number;
	environment?: readonly string[];
}

/** A queue worker — a queue and its single consumer. */
export interface QueueInfo {
	name: string;
	handler: string;
	/** SQS event-source batch size. */
	batchSize?: number;
	/** Whether the queue is FIFO. */
	fifo?: boolean;
	timeout?: number;
	memorySize?: number;
	environment?: readonly string[];
}

/**
 * The full deployment manifest — the shape of `export const manifest` in a
 * generated `manifest/<provider>.ts`. Each field is a {@link ManifestField}
 * (flat or partitioned).
 */
export interface Manifest {
	routes: ManifestField<RouteInfo>;
	functions?: ManifestField<FunctionInfo>;
	crons?: ManifestField<CronInfo>;
	subscribers?: ManifestField<SubscriberInfo>;
	queues?: ManifestField<QueueInfo>;
}
