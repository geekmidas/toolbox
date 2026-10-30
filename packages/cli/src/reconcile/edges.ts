/**
 * Edges a process records for what its runnables consume, beyond the
 * construct ids `.dependsOn()` names.
 */

import {
	type ConstructManifest,
	canonicalId,
	dependenciesOf,
	type Fn,
	provideKey,
} from '@geekmidas/manifest';

const EVENTS_SUFFIX = '#events';

/**
 * A bucket's events, as an edge: what a process running one of the bucket's
 * subscribers consumes. Not the bucket's id — binding to a bucket's changes
 * is not reading its objects, so the process is handed the events key alone.
 */
export function eventsEdge(bucketId: string): string {
	return `${bucketId}${EVENTS_SUFFIX}`;
}

/** The bucket an events edge names, or nothing for any other edge. */
export function eventsEdgeBucket(edge: string): string | undefined {
	return edge.endsWith(EVENTS_SUFFIX)
		? edge.slice(0, -EVENTS_SUFFIX.length)
		: undefined;
}

/**
 * The env key a subscriber's deliveries come from: its topic's publisher
 * connection string, or its bucket's events connection string.
 */
export function subscriberConnectionKey(construct: {
	topicName?: string;
	bucketName?: string;
}): string | undefined {
	if (construct.bucketName) {
		return provideKey(
			canonicalId(construct.bucketName),
			'eventsConnectionString',
		);
	}
	if (construct.topicName) {
		return provideKey(
			canonicalId(construct.topicName),
			'publisherConnectionString',
		);
	}
	return undefined;
}

/**
 * The key a bucket's relay token is read from, by the process that runs the
 * bucket's subscribers — beside its events connection string.
 */
export function subscriberTokenKey(construct: {
	bucketName?: string;
}): string | undefined {
	return construct.bucketName
		? provideKey(canonicalId(construct.bucketName), 'eventsToken')
		: undefined;
}

/**
 * What a worker's process reaches: the worker's own edges, and those of
 * everything it owns — its crons and functions, its queue consumers and the
 * queue each drains, its subscribers and the topic each is bound to, or the
 * events of the bucket each watches.
 *
 * Read off the manifest: the same nodes every command sees, so `gkm dev`
 * hands a worker what a deploy grants it.
 */
export function workerEdges(
	manifest: ConstructManifest,
	workerId: string,
): string[] {
	const worker = manifest[workerId];
	if (worker?.kind !== 'worker') return [];

	const edges = dependenciesOf(worker).map((edge) => edge.target);
	const owned = (fn: Fn | undefined, consumed?: string) => {
		if (fn?.owner !== workerId) return;
		edges.push(...fn.dependencies.map((edge) => edge.target));
		if (consumed) edges.push(consumed);
	};

	for (const declaration of Object.values(manifest)) {
		switch (declaration.kind) {
			case 'cron':
			case 'function':
				owned(declaration);
				break;
			case 'queue':
				owned(declaration.worker, declaration.id);
				break;
			case 'topic':
				for (const s of declaration.subscribers) owned(s, declaration.id);
				break;
			case 'objects':
				for (const s of declaration.subscribers ?? []) {
					owned(s, eventsEdge(declaration.id));
				}
				break;
		}
	}

	return [...new Set(edges)];
}
