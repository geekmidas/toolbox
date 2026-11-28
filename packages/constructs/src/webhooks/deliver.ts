import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { EventPublisher } from '@geekmidas/events';
import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import { type Kysely, type Selectable, sql } from 'kysely';
import type { Cipher } from '../encryption/cipher';
import type { WebhookLifecycleMessage } from './lifecycle';
import type {
	WebhookDeliveryRow,
	WebhookSubscriptionRow,
	WebhookTables,
} from './schema';
import { signingSecrets } from './secrets';
import type { WebhookTransport } from './transport';
import type { Webhooks } from './Webhooks';

/**
 * What delivering needs that is registered rather than declared: the tenant's
 * client, the key that opens the signing secrets, and the lifecycle topic's
 * publisher. `worker.webhooks(hooks)` registers them from the edges the hooks
 * give it; a test hands in its own.
 */
export interface WebhookDeps {
	/** The construct's tenant — `hooks.database`, registered. */
	db: Kysely<WebhookTables>;
	/** The construct's key — `hooks.encryption`, registered. */
	cipher: Cipher;
	/**
	 * Where lifecycle events go — `hooks.events`, registered. Left out, none is
	 * published. A publish that fails is logged and nothing else: it never
	 * fails, retries or repeats a delivery.
	 */
	publisher?: EventPublisher<WebhookLifecycleMessage>;
	logger?: Logger;
}

/**
 * {@link WebhookDeps} out of a runnable's services, as `worker.webhooks()`'s
 * runnables are handed them: each registered under the service name of the
 * construct it comes from — so whatever a test registers under that name is
 * what delivers.
 */
export function webhookDepsFrom(
	hooks: Pick<Webhooks, 'database' | 'encryption' | 'events'>,
	services: Record<string, unknown>,
	logger?: Logger,
): WebhookDeps {
	return {
		db: services[hooks.database.service.serviceName] as Kysely<WebhookTables>,
		cipher: services[hooks.encryption.service.serviceName] as Cipher,
		publisher: services[hooks.events.service.serviceName] as
			| EventPublisher<WebhookLifecycleMessage>
			| undefined,
		logger,
	};
}

/** What delivering reads off the construct: its own seams and settings. */
export interface WebhooksRuntime {
	readonly id: string;
	readonly topic: { readonly id: string };
	readonly eventTypes: readonly string[];
	readonly transport: WebhookTransport;
	readonly clock: () => Date;
	readonly disableAfter: number;
}

/**
 * How long after each failed attempt the next is made: attempt 1 goes out at
 * once, then 1m, 5m, 30m, 2h, 5h, 10h and 10h after the one before — eight in
 * all, a little over a day, before a delivery is abandoned.
 */
export const WEBHOOK_RETRY_SCHEDULE_MS = [
	60_000,
	5 * 60_000,
	30 * 60_000,
	2 * 3_600_000,
	5 * 3_600_000,
	10 * 3_600_000,
	10 * 3_600_000,
] as const;

/** Attempts a delivery gets before it is abandoned. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE_MS.length + 1;

/**
 * How far a delivery's `next_attempt_at` is pushed while it is being sent: a
 * process that dies mid-send leaves it to be tried again after this, not by
 * the next sweep a minute later. Longer than any request can take.
 */
export const WEBHOOK_LEASE_MS = 5 * 60_000;

/** Consecutive abandoned deliveries after which a subscription is disabled. */
export const WEBHOOK_DISABLE_AFTER = 5;

/** Why a subscription whose receiver answered 410 Gone was disabled. */
export const GONE_REASON = 'gone';

/** An event as the topic's subscriber is handed it. */
export interface WebhookSourceEvent {
	type: string;
	payload: unknown;
	/** An id the message carries, when it carries one; derived otherwise. */
	id?: string;
}

/** What one attempt came to. */
export interface WebhookAttemptOutcome {
	deliveryId: string;
	subscriptionId: string;
	/** Which attempt this was, from 1. */
	attempt: number;
	/** What the receiver answered, or `null` when it never did. */
	status: number | null;
	error: string | null;
	/** The delivery's status after it. */
	deliveryStatus: WebhookDeliveryRow['status'];
}

/** No delivery has this id. */
export class WebhookDeliveryNotFound extends Error {
	constructor(
		readonly webhooks: string,
		readonly deliveryId: string,
	) {
		super(
			`${webhooks} has no delivery '${deliveryId}'. List an owner's deliveries to find its id.`,
		);
		this.name = 'WebhookDeliveryNotFound';
	}
}

/**
 * The event's id: the one its topic's publisher stamped on it — the same on
 * every redelivery, and different for a second occurrence with the same
 * payload — so `(event_id, subscription_id)` sends each occurrence once.
 *
 * A message published without one (by something other than a topic's
 * publisher) falls back to a hash of topic, type and payload: redeliveries
 * still deduplicate, but two identical occurrences become one.
 */
export function webhookEventId(
	topic: string,
	event: WebhookSourceEvent,
): string {
	if (typeof event.id === 'string' && event.id) return event.id;
	const digest = createHash('sha256')
		.update(`${topic}\n${event.type}\n${canonicalJson(event.payload)}`)
		.digest('base64url');
	return `evt_${digest.slice(0, 32)}`;
}

/**
 * One `webhook-signature` entry: `v1,` and the base64 HMAC-SHA256 of
 * `${id}.${timestamp}.${body}`, keyed with the secret's base64 part — the
 * Standard Webhooks scheme.
 */
export function signWebhook(
	secret: string,
	id: string,
	timestamp: number,
	body: string,
): string {
	const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
	const mac = createHmac('sha256', key)
		.update(`${id}.${timestamp}.${body}`)
		.digest('base64');
	return `v1,${mac}`;
}

/**
 * The deliverer's work for one event of the topic: in one transaction, a
 * `pending` delivery for each active subscription whose events include its
 * type — none twice, as `(event_id, subscription_id)` is unique — then the
 * first attempt of each delivery that transaction created.
 *
 * An event the construct does not deliver, or one already fanned out, sends
 * nothing.
 */
export async function deliverEvent(
	hooks: WebhooksRuntime,
	deps: WebhookDeps,
	event: WebhookSourceEvent,
): Promise<WebhookAttemptOutcome[]> {
	if (!(hooks.eventTypes as readonly string[]).includes(event.type)) return [];

	const now = hooks.clock();
	const eventId = webhookEventId(hooks.topic.id, event);
	// Leased from the start: a process that dies before the first attempt
	// leaves it for the sweep.
	const lease = new Date(now.getTime() + WEBHOOK_LEASE_MS);

	const created = await deps.db.transaction().execute(async (trx) => {
		const subscriptions = await trx
			.selectFrom('webhook_subscriptions')
			.selectAll()
			.where('status', '=', 'active')
			.where(sql<boolean>`${event.type} = any(events)`)
			.execute();
		if (subscriptions.length === 0) return [];

		const deliveries = await trx
			.insertInto('webhook_deliveries')
			.values(
				subscriptions.map((subscription) => ({
					id: `msg_${randomUUID().replaceAll('-', '')}`,
					subscription_id: subscription.id,
					event_id: eventId,
					event_type: event.type,
					payload: JSON.stringify(event.payload ?? null),
					occurred_at: now,
					status: 'pending' as const,
					next_attempt_at: lease,
					last_status: null,
					last_error: null,
					delivered_at: null,
				})),
			)
			.onConflict((conflict) =>
				conflict.columns(['event_id', 'subscription_id']).doNothing(),
			)
			.returningAll()
			.execute();

		return deliveries.map((delivery) => ({
			delivery,
			subscription: subscriptions.find(
				(s) => s.id === delivery.subscription_id,
			) as Selectable<WebhookSubscriptionRow>,
		}));
	});

	return Promise.all(
		created.map(({ delivery, subscription }) =>
			attempt(hooks, deps, delivery, subscription),
		),
	);
}

/**
 * The sweep's work: claim the pending deliveries that are due — of active
 * subscriptions only — and attempt each.
 *
 * Claiming is one statement, `FOR UPDATE SKIP LOCKED`, that pushes each
 * claimed row's `next_attempt_at` a lease ahead: two sweeps never take the
 * same row, and one that dies mid-send leaves it to be retried after the
 * lease rather than sent again at once.
 */
export async function sweepDue(
	hooks: WebhooksRuntime,
	deps: WebhookDeps,
	options: { limit?: number } = {},
): Promise<WebhookAttemptOutcome[]> {
	const now = hooks.clock();
	const lease = new Date(now.getTime() + WEBHOOK_LEASE_MS);
	const limit = options.limit ?? 100;

	const { rows: claimed } = await sql<Selectable<WebhookDeliveryRow>>`
		update webhook_deliveries set next_attempt_at = ${lease}
		where id in (
			select d.id from webhook_deliveries d
			join webhook_subscriptions s on s.id = d.subscription_id
			where d.status = 'pending'
				and d.next_attempt_at <= ${now}
				and s.status = 'active'
			order by d.next_attempt_at
			limit ${limit}
			for update of d skip locked
		)
		returning *
	`.execute(deps.db);
	if (claimed.length === 0) return [];

	const subscriptions = await deps.db
		.selectFrom('webhook_subscriptions')
		.selectAll()
		.where('id', 'in', [...new Set(claimed.map((d) => d.subscription_id))])
		.execute();
	const byId = new Map(subscriptions.map((s) => [s.id, s]));

	return Promise.all(
		claimed.flatMap((delivery) => {
			const subscription = byId.get(delivery.subscription_id);
			return subscription ? [attempt(hooks, deps, delivery, subscription)] : [];
		}),
	);
}

/**
 * Send a delivery again, under the same `webhook-id`, as a new attempt —
 * whatever its status, and whatever its subscription's.
 *
 * A 2xx marks it delivered. A failure is recorded and changes nothing else: a
 * pending delivery keeps its schedule, and one already delivered or
 * abandoned stays so. A 410 still disables the subscription.
 *
 * @throws {WebhookDeliveryNotFound}
 */
export async function redeliver(
	hooks: WebhooksRuntime,
	deps: WebhookDeps,
	deliveryId: string,
): Promise<WebhookAttemptOutcome> {
	const delivery = await deps.db
		.selectFrom('webhook_deliveries')
		.selectAll()
		.where('id', '=', deliveryId)
		.executeTakeFirst();
	if (!delivery) throw new WebhookDeliveryNotFound(hooks.id, deliveryId);

	const subscription = await deps.db
		.selectFrom('webhook_subscriptions')
		.selectAll()
		.where('id', '=', delivery.subscription_id)
		.executeTakeFirstOrThrow();

	return attempt(hooks, deps, delivery, subscription, { manual: true });
}

/**
 * Publish lifecycle events, after whatever they report is stored. A failure
 * is logged and swallowed: the delivery it reports on is already decided.
 */
export async function announce(
	hooks: Pick<WebhooksRuntime, 'id'>,
	deps: Pick<WebhookDeps, 'publisher' | 'logger'>,
	messages: WebhookLifecycleMessage[],
): Promise<void> {
	if (!deps.publisher || messages.length === 0) return;
	try {
		await deps.publisher.publish(messages);
	} catch (error) {
		(deps.logger ?? DEFAULT_LOGGER).error(
			{ err: error, webhooks: hooks.id, types: messages.map((m) => m.type) },
			'Publishing webhook lifecycle events failed; the deliveries are unaffected',
		);
	}
}

/**
 * One request for a delivery, and everything it decides: the attempt's
 * record, the delivery's status and next attempt, the subscription's failure
 * count — one transaction — then the lifecycle events.
 */
async function attempt(
	hooks: WebhooksRuntime,
	deps: WebhookDeps,
	delivery: Selectable<WebhookDeliveryRow>,
	subscription: Selectable<WebhookSubscriptionRow>,
	options: { manual?: boolean } = {},
): Promise<WebhookAttemptOutcome> {
	const sentAt = hooks.clock();
	const { status, error, latencyMs } = await send(
		hooks,
		deps,
		delivery,
		subscription,
		sentAt,
	);
	const decidedAt = hooks.clock();

	const ok = status !== null && status >= 200 && status < 300;
	const gone = status === 410;
	const number = delivery.attempts + 1;
	const manual = options.manual === true;

	let next: Pick<
		Selectable<WebhookDeliveryRow>,
		'status' | 'next_attempt_at' | 'delivered_at'
	>;
	if (ok) {
		next = {
			status: 'delivered',
			next_attempt_at: null,
			delivered_at: decidedAt,
		};
	} else if (manual && !(gone && delivery.status === 'pending')) {
		// A redelivery that failed changes no schedule.
		next = {
			status: delivery.status,
			next_attempt_at: delivery.next_attempt_at,
			delivered_at: delivery.delivered_at,
		};
	} else if (gone || number >= WEBHOOK_MAX_ATTEMPTS) {
		next = { status: 'abandoned', next_attempt_at: null, delivered_at: null };
	} else {
		next = {
			status: 'pending',
			next_attempt_at: new Date(
				decidedAt.getTime() + WEBHOOK_RETRY_SCHEDULE_MS[number - 1]!,
			),
			delivered_at: null,
		};
	}
	const abandoned =
		next.status === 'abandoned' && delivery.status !== 'abandoned';

	const disabled = await deps.db.transaction().execute(async (trx) => {
		await trx
			.insertInto('webhook_attempts')
			.values({
				delivery_id: delivery.id,
				attempted_at: sentAt,
				status,
				latency_ms: latencyMs,
				error,
			})
			.execute();

		await trx
			.updateTable('webhook_deliveries')
			.set({
				...next,
				attempts: sql`attempts + 1`,
				last_status: status,
				last_error: error,
			})
			.where('id', '=', delivery.id)
			.execute();

		if (ok) {
			await trx
				.updateTable('webhook_subscriptions')
				.set({ consecutive_failures: 0 })
				.where('id', '=', subscription.id)
				.execute();
			return undefined;
		}

		if (gone) return disable(trx, subscription.id, GONE_REASON, decidedAt);

		if (abandoned) {
			const counted = await trx
				.updateTable('webhook_subscriptions')
				.set({ consecutive_failures: sql`consecutive_failures + 1` })
				.where('id', '=', subscription.id)
				.returning('consecutive_failures')
				.executeTakeFirst();
			const failures = counted?.consecutive_failures ?? 0;
			if (failures >= hooks.disableAfter) {
				return disable(
					trx,
					subscription.id,
					`${failures} deliveries in a row were abandoned`,
					decidedAt,
				);
			}
		}
		return undefined;
	});

	const ref = {
		deliveryId: delivery.id,
		subscriptionId: subscription.id,
		owner: subscription.owner,
		eventId: delivery.event_id,
		eventType: delivery.event_type,
	};
	const messages: WebhookLifecycleMessage[] = [];
	if (ok) {
		messages.push({
			type: 'delivery.succeeded',
			payload: { ...ref, attempts: number, status: status as number },
		});
	} else {
		messages.push({
			type: 'delivery.failed',
			payload: {
				...ref,
				attempt: number,
				status,
				error,
				nextAttemptAt:
					next.status === 'pending' && next.next_attempt_at
						? next.next_attempt_at.toISOString()
						: null,
			},
		});
	}
	if (abandoned) {
		messages.push({
			type: 'delivery.abandoned',
			payload: {
				...ref,
				attempts: number,
				lastStatus: status,
				lastError: error,
			},
		});
	}
	if (disabled) {
		messages.push({
			type: 'subscription.disabled',
			payload: {
				subscriptionId: subscription.id,
				owner: subscription.owner,
				reason: disabled,
			},
		});
	}
	await announce(hooks, deps, messages);

	return {
		deliveryId: delivery.id,
		subscriptionId: subscription.id,
		attempt: number,
		status,
		error,
		deliveryStatus: next.status,
	};
}

/** The signed request, through the construct's transport. */
async function send(
	hooks: WebhooksRuntime,
	deps: WebhookDeps,
	delivery: Selectable<WebhookDeliveryRow>,
	subscription: Selectable<WebhookSubscriptionRow>,
	now: Date,
): Promise<{ status: number | null; error: string | null; latencyMs: number }> {
	const body = JSON.stringify({
		id: delivery.event_id,
		type: delivery.event_type,
		occurredAt: delivery.occurred_at.toISOString(),
		payload: delivery.payload,
	});
	const timestamp = Math.floor(now.getTime() / 1000);
	const secrets = await signingSecrets(subscription, deps.cipher, now);
	const signature = secrets
		.map((secret) => signWebhook(secret, delivery.id, timestamp, body))
		.join(' ');

	// Latency is measured, not scheduled: the monotonic clock, not `hooks.clock`.
	const started = performance.now();
	try {
		const response = await hooks.transport(
			new Request(subscription.url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'user-agent': 'geekmidas-webhooks',
					'webhook-id': delivery.id,
					'webhook-timestamp': String(timestamp),
					'webhook-signature': signature,
				},
				body,
			}),
		);
		await response.body?.cancel().catch(() => undefined);
		const ok = response.status >= 200 && response.status < 300;
		return {
			status: response.status,
			error: ok ? null : describeStatus(response),
			latencyMs: Math.round(performance.now() - started),
		};
	} catch (error) {
		return {
			status: null,
			error: error instanceof Error ? error.message : String(error),
			latencyMs: Math.round(performance.now() - started),
		};
	}
}

function describeStatus(response: Response): string {
	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get('location');
		return `answered ${response.status}${location ? ` to ${location}` : ''}; redirects are not followed`;
	}
	return `answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
}

/** Disable an active subscription; the reason when it was, `undefined` when it already wasn't. */
async function disable(
	trx: Kysely<WebhookTables>,
	subscriptionId: string,
	reason: string,
	now: Date,
): Promise<string | undefined> {
	const row = await trx
		.updateTable('webhook_subscriptions')
		.set({ status: 'disabled', disabled_reason: reason, updated_at: now })
		.where('id', '=', subscriptionId)
		.where('status', '=', 'active')
		.returning('id')
		.executeTakeFirst();
	return row ? reason : undefined;
}

/** JSON with object keys sorted, so the same value always hashes the same. */
function canonicalJson(value: unknown): string {
	if (value === undefined) return 'null';
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (value instanceof Date) return JSON.stringify(value.toISOString());
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
