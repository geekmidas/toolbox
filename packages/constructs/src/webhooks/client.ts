import { randomBytes, randomUUID } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { Cipher } from '../encryption/cipher';
import type {
	WebhookSubscriptionRow,
	WebhookSubscriptionStatus,
	WebhookTables,
} from './schema';
import { assertDeliverableUrl } from './url';

/** A subscription as the app sees it — never with its secret. */
export interface WebhookSubscription<TEvent extends string = string> {
	id: string;
	owner: string;
	url: string;
	events: TEvent[];
	status: WebhookSubscriptionStatus;
	disabledReason: string | null;
	createdAt: Date;
}

/** What `subscribe` stores. */
export interface SubscribeInput<TEvent extends string = string> {
	owner: string;
	url: string;
	events: readonly TEvent[];
}

/**
 * What `services.<webhooks>` is: managing who receives the events. Which of
 * these an app exposes, and to whom, is its own endpoints' choice.
 */
export interface WebhooksClient<TEvent extends string = string> {
	/**
	 * Store a subscription, with a new signing secret. The secret is returned
	 * here and never again — the receiver keeps it to verify deliveries.
	 *
	 * @throws {WebhookUrlNotDeliverable} when the URL can't receive deliveries
	 * @throws {UnknownWebhookEvent} when an event is not one these webhooks send
	 */
	subscribe(
		input: SubscribeInput<TEvent>,
	): Promise<{ subscription: WebhookSubscription<TEvent>; secret: string }>;
	/** An owner's subscriptions, newest first. */
	list(owner: string): Promise<WebhookSubscription<TEvent>[]>;
	/** @throws {WebhookSubscriptionNotFound} */
	get(id: string): Promise<WebhookSubscription<TEvent>>;
	/** Stop delivering to it, with why. Its deliveries stay. @throws {WebhookSubscriptionNotFound} */
	disable(id: string, reason: string): Promise<WebhookSubscription<TEvent>>;
	/** Deliver to it again, from the next event on. @throws {WebhookSubscriptionNotFound} */
	enable(id: string): Promise<WebhookSubscription<TEvent>>;
	/** Delete it and every delivery made for it. @throws {WebhookSubscriptionNotFound} */
	remove(id: string): Promise<void>;
	/**
	 * A new signing secret. The old one keeps signing beside it for `overlap`
	 * (a day by default), so a receiver can switch without missing a delivery.
	 *
	 * @throws {WebhookSubscriptionNotFound}
	 */
	rotateSecret(
		id: string,
		options?: { overlapMs?: number },
	): Promise<{ secret: string }>;
}

/** No subscription has this id. */
export class WebhookSubscriptionNotFound extends Error {
	constructor(
		readonly webhooks: string,
		readonly subscriptionId: string,
	) {
		super(
			`${webhooks} has no subscription '${subscriptionId}'. List the owner's subscriptions to find its id.`,
		);
		this.name = 'WebhookSubscriptionNotFound';
	}
}

/** A subscription named an event these webhooks don't send. */
export class UnknownWebhookEvent extends Error {
	constructor(
		readonly webhooks: string,
		readonly event: string,
		readonly events: readonly string[],
	) {
		super(
			`${webhooks} doesn't send '${event}'. Subscribe to ${events.map((e) => `'${e}'`).join(', ')}.`,
		);
		this.name = 'UnknownWebhookEvent';
	}
}

/** A subscription named no events at all. */
export class NoWebhookEvents extends Error {
	constructor(readonly webhooks: string) {
		super(
			`A ${webhooks} subscription has to name at least one event to receive.`,
		);
		this.name = 'NoWebhookEvents';
	}
}

/** How long a rotated-out secret keeps signing. */
export const SECRET_OVERLAP_MS = 24 * 60 * 60 * 1000;

/**
 * A signing secret in the Standard Webhooks form: `whsec_` and 24 random
 * bytes, base64 — what the receiver's verifier is handed as it is.
 */
export function newSigningSecret(): string {
	return `whsec_${randomBytes(24).toString('base64')}`;
}

export function webhooksClient<TEvent extends string>(options: {
	id: string;
	events: readonly TEvent[];
	db: Kysely<WebhookTables>;
	cipher: Cipher;
	now?: () => Date;
}): WebhooksClient<TEvent> {
	const { id, events, db, cipher } = options;
	const now = options.now ?? (() => new Date());

	const find = async (subscriptionId: string) => {
		const row = await db
			.selectFrom('webhook_subscriptions')
			.selectAll()
			.where('id', '=', subscriptionId)
			.executeTakeFirst();
		if (!row) throw new WebhookSubscriptionNotFound(id, subscriptionId);
		return row;
	};

	const update = async (
		subscriptionId: string,
		values: Partial<Selectable<WebhookSubscriptionRow>>,
	) => {
		const row = await db
			.updateTable('webhook_subscriptions')
			.set({ ...values, updated_at: now() })
			.where('id', '=', subscriptionId)
			.returningAll()
			.executeTakeFirst();
		if (!row) throw new WebhookSubscriptionNotFound(id, subscriptionId);
		return toSubscription<TEvent>(row);
	};

	return {
		async subscribe(input) {
			assertDeliverableUrl(input.url);
			if (input.events.length === 0) throw new NoWebhookEvents(id);
			for (const event of input.events) {
				if (!events.includes(event)) {
					throw new UnknownWebhookEvent(id, event, events);
				}
			}

			const secret = newSigningSecret();
			const row = await db
				.insertInto('webhook_subscriptions')
				.values({
					id: `sub_${randomUUID()}`,
					owner: input.owner,
					url: input.url,
					events: [...new Set(input.events)],
					secret: await cipher.encrypt(secret),
					previous_secret: null,
					previous_secret_expires_at: null,
					status: 'active',
					disabled_reason: null,
				})
				.returningAll()
				.executeTakeFirstOrThrow();

			return { subscription: toSubscription<TEvent>(row), secret };
		},

		async list(owner) {
			const rows = await db
				.selectFrom('webhook_subscriptions')
				.selectAll()
				.where('owner', '=', owner)
				.orderBy('created_at', 'desc')
				.execute();
			return rows.map((row) => toSubscription<TEvent>(row));
		},

		async get(subscriptionId) {
			return toSubscription<TEvent>(await find(subscriptionId));
		},

		disable(subscriptionId, reason) {
			return update(subscriptionId, {
				status: 'disabled',
				disabled_reason: reason,
			});
		},

		enable(subscriptionId) {
			return update(subscriptionId, {
				status: 'active',
				disabled_reason: null,
				consecutive_failures: 0,
			});
		},

		async remove(subscriptionId) {
			const result = await db
				.deleteFrom('webhook_subscriptions')
				.where('id', '=', subscriptionId)
				.executeTakeFirst();
			if (!result.numDeletedRows) {
				throw new WebhookSubscriptionNotFound(id, subscriptionId);
			}
		},

		async rotateSecret(subscriptionId, rotate = {}) {
			const current = await find(subscriptionId);
			const secret = newSigningSecret();
			await update(subscriptionId, {
				secret: await cipher.encrypt(secret),
				previous_secret: current.secret,
				previous_secret_expires_at: new Date(
					now().getTime() + (rotate.overlapMs ?? SECRET_OVERLAP_MS),
				),
			});
			return { secret };
		},
	};
}

/**
 * The secrets a delivery to this subscription is signed with, in plaintext:
 * its current one, and the one it replaced while that still overlaps.
 */
export async function signingSecrets(
	row: Pick<
		Selectable<WebhookSubscriptionRow>,
		'secret' | 'previous_secret' | 'previous_secret_expires_at'
	>,
	cipher: Cipher,
	now: Date = new Date(),
): Promise<string[]> {
	const secrets = [await cipher.decrypt(row.secret)];
	if (
		row.previous_secret &&
		row.previous_secret_expires_at &&
		row.previous_secret_expires_at > now
	) {
		secrets.push(await cipher.decrypt(row.previous_secret));
	}
	return secrets;
}

function toSubscription<TEvent extends string>(
	row: Selectable<WebhookSubscriptionRow>,
): WebhookSubscription<TEvent> {
	return {
		id: row.id,
		owner: row.owner,
		url: row.url,
		events: row.events as TEvent[],
		status: row.status,
		disabledReason: row.disabled_reason,
		createdAt: row.created_at,
	};
}
