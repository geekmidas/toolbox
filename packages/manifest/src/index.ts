/**
 * Deployment manifest types — the build output of `gkm build` that enumerates a
 * project's deployable units (routes, functions, crons, subscribers) with the
 * metadata an infrastructure layer needs to provision them.
 *
 * This is a stable, dependency-free data contract shared between the producer
 * (`@geekmidas/cli`) and consumers (e.g. `@geekmidas/cloud/sst`'s
 * `fromManifest` integrators).
 */

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
	environment?: string[];
	/** Authorizer name: `none`, `iam`, or a declared authorizer. */
	authorizer: string;
}

/** A standalone Lambda function. */
export interface FunctionInfo {
	name: string;
	handler: string;
	timeout?: number;
	memorySize?: number;
	environment?: string[];
}

/** A scheduled (cron) function. */
export interface CronInfo {
	name: string;
	handler: string;
	/** Schedule expression, e.g. `rate(1 day)` or `cron(0 12 * * ? *)`. */
	schedule: string;
	timeout?: number;
	memorySize?: number;
	environment?: string[];
}

/** An event subscriber function. */
export interface SubscriberInfo {
	name: string;
	handler: string;
	subscribedEvents: string[];
	timeout?: number;
	memorySize?: number;
	environment?: string[];
}

export interface RoutesManifest {
	routes: RouteInfo[];
}

export interface FunctionsManifest {
	functions: FunctionInfo[];
}

export interface CronsManifest {
	crons: CronInfo[];
}

export interface SubscribersManifest {
	subscribers: SubscriberInfo[];
}
