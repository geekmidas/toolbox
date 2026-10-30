/**
 * The manifest, written out as a module.
 *
 * Discovery imports the application's own code — that is how it finds
 * constructs — so anything calling it evaluates the whole runtime graph: React
 * email templates, database clients, modules that read env at import time. That
 * is fine inside `gkm dev`, which is already running the app. It is not fine
 * inside a deploy config, where it fails on the first thing the deploy toolchain
 * does not expect and would keep failing on the next.
 *
 * So discovery happens once, in the build, and everything downstream reads what
 * it wrote. The same split `RestApi` makes by naming a routes glob rather than
 * importing route modules.
 *
 * A module rather than JSON, because a manifest is not just data to this
 * codebase — `as const satisfies ConstructManifest` is what keeps every id,
 * kind and provided key a *literal*, so `IdsOf`, `ProvidedKeys` and the rest
 * can select out of it. `JSON.parse` returns `any` and gives all of that up.
 */

import type {
	ConstructManifest,
	CronInfo,
	Declaration,
	FunctionInfo,
	ProcessorInfo,
	QueueInfo,
	RouteInfo,
	SubscriberInfo,
} from '@geekmidas/manifest';
import { canonicalId } from '@geekmidas/manifest';
import type { CacheBackend, EmailBackend } from '../types.js';

/** What a build generated: the entry each handler was written to. */
export interface GeneratedHandlers {
	/** Each route, with the surface the app that generated it serves. */
	routes?: readonly (RouteInfo & { surface?: string })[];
	functions?: readonly FunctionInfo[];
	crons?: readonly CronInfo[];
	queues?: readonly QueueInfo[];
	subscribers?: readonly SubscriberInfo[];
	processors?: readonly ProcessorInfo[];
}

/**
 * Point each handler discovery found at the entry the build generated for it.
 *
 * Discovery already nested every endpoint, route, cron, function, consumer,
 * subscriber and processor, with its edges — the graph is the same for every
 * command. A build adds one fact: where it wrote each handler. So this
 * replaces `handler` and nothing else, and a handler the build generated no
 * entry of its own for keeps its source.
 *
 * That is the `server` provider's whole application: it generates one
 * catch-all — `ALL *` pointing at the Hono app that routes in-process — which
 * matches no endpoint, so every endpoint keeps the source it was found at.
 */
export function withHandlers(
	manifest: ConstructManifest,
	generated: GeneratedHandlers,
): ConstructManifest {
	const next: Record<string, Declaration> = { ...manifest };
	const at = <T extends { id: string; handler: string }>(
		list: readonly T[],
		id: string,
		handler: string,
	): T[] => list.map((item) => (item.id === id ? { ...item, handler } : item));

	for (const route of generated.routes ?? []) {
		for (const [id, declaration] of Object.entries(next)) {
			if (declaration.kind !== 'rest-api') continue;
			if (route.surface && route.surface !== id) continue;
			next[id] = {
				...declaration,
				endpoints: declaration.endpoints.map((endpoint) =>
					endpoint.method === route.method && endpoint.path === route.path
						? { ...endpoint, handler: route.handler }
						: endpoint,
				),
			};
		}
	}

	for (const fn of [
		...(generated.functions ?? []),
		...(generated.crons ?? []),
	]) {
		const declaration = next[fn.name];
		if (declaration?.kind === 'function' || declaration?.kind === 'cron') {
			next[fn.name] = { ...declaration, handler: fn.handler };
		}
	}

	for (const consumer of generated.queues ?? []) {
		const queue = next[canonicalId(consumer.name)];
		if (queue?.kind !== 'queue') continue;
		next[queue.id] = {
			...queue,
			worker: { ...queue.worker, handler: consumer.handler },
		};
	}

	for (const subscriber of generated.subscribers ?? []) {
		const bucket = subscriber.bucket
			? next[canonicalId(subscriber.bucket)]
			: undefined;
		if (bucket?.kind === 'objects') {
			next[bucket.id] = {
				...bucket,
				subscribers: at(
					bucket.subscribers ?? [],
					subscriber.name,
					subscriber.handler,
				),
			};
			continue;
		}
		const topic = subscriber.topic
			? next[canonicalId(subscriber.topic)]
			: undefined;
		if (topic?.kind !== 'topic') continue;
		next[topic.id] = {
			...topic,
			subscribers: at(topic.subscribers, subscriber.name, subscriber.handler),
		};
	}

	for (const processor of generated.processors ?? []) {
		const server = next[processor.fileServer];
		if (server?.kind !== 'file-server') continue;
		next[server.id] = {
			...server,
			processors: at(
				server.processors ?? [],
				processor.name,
				processor.handler,
			),
		};
	}

	return next;
}

/**
 * The manifest as TypeScript source.
 *
 * Pure, so what gets written can be asserted without touching a filesystem.
 */
export function manifestModule(
	manifest: ConstructManifest,
	backends: Backends = {},
): string {
	return `${HEADER}
export const constructs = ${serialise(manifest)} as const satisfies ConstructManifest;

/**
 * Where the backends that are *config* rather than declaration resolved to.
 *
 * Recorded because they were being answered twice: once by the build, which
 * registers exactly one cache driver, and once by a deploy config, which told
 * the provisioner something else. The result was a deployed URL the running code
 * had no driver for — two documents disagreeing about one fact, which is what
 * this manifest exists to stop.
 */
export const backends = ${serialise(backends)} as const;

// Derived types
export type Ids = IdsOf<typeof constructs>;
export type Construct<Id extends Ids> = DeclarationOf<typeof constructs, Id>;
export type Kind = Construct<Ids>['kind'];

// Useful union types
export type ProvidedKeys = AllProvidedKeys<typeof constructs>;
export type Surfaces = IdsOfKind<typeof constructs, 'rest-api'>;
export type CacheBackend = (typeof backends)['cache'];
export type EmailBackend = (typeof backends)['email'];
`;
}

/** The choices that are deployment config rather than declaration. */
export interface Backends {
	cache?: CacheBackend;
	email?: EmailBackend;
	/**
	 * The labels no tenant of the wildcard site may take — every app's own
	 * and the workspace's `protectedSubdomains`. Config the AWS target cannot
	 * read for itself, so it travels with the manifest.
	 */
	protectedSubdomains?: readonly string[];
}

const HEADER = `// Generated by \`gkm build\`. Do not edit.
//
// Discovery imports application code, so it runs once here rather than in every
// consumer — a deploy config that discovered for itself would evaluate the whole
// runtime graph inside its own toolchain. This is the result, as literals.

import type {
	AllProvidedKeys,
	ConstructManifest,
	DeclarationOf,
	IdsOf,
	IdsOfKind,
} from '@geekmidas/manifest';
`;

/**
 * JSON, re-indented with tabs and with keys left unquoted where they can be.
 *
 * Cosmetic, and worth it: this file is read by people trying to work out what
 * their app declares, and a wall of quoted keys reads as output rather than as
 * something anyone is expected to understand.
 */
function serialise(value: object): string {
	return JSON.stringify(value, null, '\t')
		.replace(/^(\t*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:')
		.replace(/"/g, "'");
}
