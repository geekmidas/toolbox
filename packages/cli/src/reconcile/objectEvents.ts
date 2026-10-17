/**
 * A bucket's object events, where the bucket is a local MinIO.
 *
 * S3 publishes a bucket's events to a topic the deploy creates; MinIO has no
 * topic to publish to, but it can post each event to a webhook. So where MinIO
 * holds a watched bucket, it posts the bucket's events to the process that
 * runs the bucket's subscribers, on a route only it can use, and that process
 * relays each one onto the events broker — under the bucket's name, as
 * `object.created` or `object.deleted` — where every subscriber drains a queue
 * of its own, as a topic's subscribers do.
 *
 * Declared to MinIO in two halves, both derived here so they cannot drift:
 *
 * - **a webhook target per bucket**, as container environment: where to post,
 *   the token to present, and a queue on disk, because MinIO starts before the
 *   process it posts to and must keep what it could not deliver;
 * - **the bucket's notification**, written through the S3 API once the bucket
 *   exists: every created and removed object, to that target. Unfiltered —
 *   two subscribers watching overlapping prefixes are two rules S3 refuses on
 *   one bucket, and each subscriber filters what it is handed anyway.
 */

import { createHash } from 'node:crypto';
import { type ConstructManifest, provideKey } from '@geekmidas/manifest';
import type { BoundSubscriber } from './discover.js';
import type { BucketNotification } from './provision.js';

/** Where MinIO posts one bucket's events. */
export interface ObjectWebhook {
	/** The bucket construct, `Uploads`. */
	bucket: string;
	/** The route on the process that runs the bucket's subscribers. */
	endpoint: string;
	/** What MinIO presents, and that process checks. */
	token: string;
}

/**
 * The token MinIO presents when it posts a bucket's events.
 *
 * Derived, never stored: the container and the process it posts to are handed
 * the same value by the same derivation — with the stage's random seed where a
 * deployed stage's stack has one, so the token is a secret there, and from the
 * project alone locally, where everything it would protect is on loopback.
 * Not salted by the stage: one MinIO serves `gkm dev` and `gkm test`, and a
 * target is declared once per container.
 */
export function objectsWebhookToken(
	project: string,
	bucket: string,
	seed?: string,
): string {
	return createHash('sha256')
		.update(`${seed ? `${seed}:` : ''}${project}:objects-webhook:${bucket}`)
		.digest('base64url')
		.slice(0, 32);
}

/**
 * The target's id in MinIO's environment — `MINIO_NOTIFY_WEBHOOK_*_<ID>`.
 *
 * Upper-cased with nothing between words: a canonical id is letters and
 * digits, and an underscore inside the id would read as part of the setting's
 * name.
 */
export function minioTargetId(bucket: string): string {
	return bucket.toUpperCase();
}

/** The target as a notification names it. */
export function minioTargetArn(bucket: string): string {
	return `arn:minio:sqs::${minioTargetId(bucket)}:webhook`;
}

/** How a container reaches a process on the host. */
export const HOST_GATEWAY = 'host.docker.internal';

/** Where MinIO keeps what it could not deliver yet, inside its container. */
const QUEUE_ROOT = '/gkm-object-events';

/** The id of the notification rule gkm owns on a bucket. */
export const NOTIFICATION_RULE_PREFIX = 'gkm-';

/**
 * MinIO's environment for each watched bucket's webhook target.
 *
 * Sorted, so the same buckets always render the same environment and a
 * reconcile that changed nothing does not recreate the container.
 */
export function minioWebhookEnv(
	hooks: readonly ObjectWebhook[],
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const hook of [...hooks].sort((a, b) =>
		a.bucket.localeCompare(b.bucket),
	)) {
		const id = minioTargetId(hook.bucket);
		env[`MINIO_NOTIFY_WEBHOOK_ENABLE_${id}`] = 'on';
		env[`MINIO_NOTIFY_WEBHOOK_ENDPOINT_${id}`] = hook.endpoint;
		// Sent as `Authorization: Bearer <token>`.
		env[`MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_${id}`] = hook.token;
		// MinIO is up before whatever it posts to: what it cannot deliver is
		// kept here and sent once the route answers.
		env[`MINIO_NOTIFY_WEBHOOK_QUEUE_DIR_${id}`] =
			`${QUEUE_ROOT}/${id.toLowerCase()}`;
	}
	return env;
}

/** The rule that sends every created and removed object to the bucket's target. */
export function minioNotificationRule(
	bucket: string,
): NonNullable<BucketNotification['QueueConfigurations']>[number] {
	return {
		Id: `${NOTIFICATION_RULE_PREFIX}${bucket}`,
		QueueArn: minioTargetArn(bucket),
		Events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
	};
}

/**
 * Each watched bucket, and the workers that run one of its subscribers.
 *
 * A bucket is watched when a subscriber reads its events key. MinIO posts a
 * bucket's events to one place, and the relay fans them out to every
 * subscriber whichever worker received them — so one worker per bucket is
 * enough, and the first, by id, is the one chosen, so the choice is stable.
 */
export function watchedBuckets(
	manifest: ConstructManifest,
	subscribers: Readonly<Record<string, readonly BoundSubscriber[]>>,
): Map<string, string> {
	const byKey = new Map<string, string>();
	for (const declaration of Object.values(manifest)) {
		if (declaration.kind !== 'objects') continue;
		byKey.set(
			provideKey(declaration.id, 'eventsConnectionString'),
			declaration.id,
		);
	}

	const watched = new Map<string, string>();
	for (const worker of Object.keys(subscribers).sort()) {
		for (const { connectionKey } of subscribers[worker] ?? []) {
			const bucket = byKey.get(connectionKey);
			if (bucket && !watched.has(bucket)) watched.set(bucket, worker);
		}
	}
	return watched;
}
