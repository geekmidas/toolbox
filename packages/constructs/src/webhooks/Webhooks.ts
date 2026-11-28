import {
	type ConstructName,
	canonicalId,
	type Declaration,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { type Kysely, sql } from 'kysely';
import type { Consumable } from '../construct-interface';
import type { KyselyDatabase } from '../database/kysely';
import type { Encryption } from '../encryption';
import { WebhookEventNotOnTopic } from '../endpoints/webhooks';
import { Topic, type TopicEvents } from '../topic/Topic';
import { type WebhooksClient, webhooksClient } from './client';
import { WEBHOOK_DISABLE_AFTER, type WebhookDeps } from './deliver';
import {
	WEBHOOK_LIFECYCLE_EVENTS,
	type WebhookLifecycleEvents,
	type WebhookLifecycleMessage,
} from './lifecycle';
import {
	WEBHOOK_TABLES,
	WEBHOOK_TABLES_SQL,
	type WebhookTables,
} from './schema';
import { defaultTransport, type WebhookTransport } from './transport';

/** What `api.webhooks(id, options)` is given. */
export interface WebhooksOptions<
	TEvents extends TopicEvents,
	TEvent extends keyof TEvents & string,
> {
	/** The topic whose events are delivered. Publishing to it is unchanged. */
	topic: Topic<string, TEvents>;
	/** The topic's events that are delivered — every one, when left out. */
	events?: readonly TEvent[];
	/**
	 * Where subscriptions, deliveries and attempts are stored: a tenant of the
	 * app's database (`db.schema('Webhooks')`), whose migrations folder
	 * `gkm migration <id>` writes the tables into.
	 */
	database: KyselyDatabase<any, any>;
	/** The key each subscription's signing secret is encrypted with. */
	encryption: Encryption;
	/**
	 * Consecutive abandoned deliveries after which a subscription is disabled,
	 * and `subscription.disabled` published. Five by default.
	 */
	disableAfter?: number;
}

/**
 * Webhooks: the signed requests this service sends to the URLs its users
 * register, one for each event of `topic` they subscribed to.
 *
 * Built from the API that owns it — `api.webhooks('BillingHooks', …)` — and
 * documented in that API's OpenAPI document only. Another surface can
 * `.dependsOn([hooks])` to manage its subscriptions without listing them.
 *
 * A runnable that depends on it is given `services.<hooks>` and edges to the
 * tenant and the key it reaches through it, so it is granted exactly those.
 */
export class Webhooks<
	TName extends string = string,
	TEvents extends TopicEvents = TopicEvents,
	TEvent extends keyof TEvents & string = keyof TEvents & string,
> implements Consumable<TName, WebhooksClient<TEvent>>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, WebhooksClient<TEvent>>;
	/** The API whose document lists these webhooks. */
	readonly owner: string;
	readonly topic: Topic<string, TEvents>;
	/** The events of `topic` delivered, in the order given. */
	readonly eventTypes: readonly TEvent[];
	/**
	 * What happens to deliveries, as events: a topic this construct owns,
	 * `<id>Events`, carrying `delivery.succeeded`, `delivery.failed` (one per
	 * failed attempt), `delivery.abandoned`, `subscription.disabled` and
	 * `secret.rotated`. Apps react with `worker.topic(hooks.events)`; a
	 * reaction that throws never retries or repeats a delivery.
	 */
	readonly events: Topic<`${TName}Events`, WebhookLifecycleEvents>;
	readonly database: KyselyDatabase<any, any>;
	readonly encryption: Encryption;
	/** Consecutive abandoned deliveries after which a subscription is disabled. */
	readonly disableAfter: number;
	/**
	 * What a runnable depending on this reaches through it — and so is given
	 * an edge to, beside this one: its tenant, its key, and its lifecycle
	 * topic, which managing a subscription publishes to.
	 */
	readonly reaches: readonly Consumable[];
	/**
	 * How a delivery's request leaves the process: {@link defaultTransport},
	 * which checks every address it connects to, follows no redirect, times
	 * out after ten seconds and reads 64 KiB of an answer at most. A test
	 * swaps it.
	 */
	transport: WebhookTransport = defaultTransport;
	/**
	 * What time it is, for everything this construct schedules and signs —
	 * the next attempt, the signature's timestamp, a rotated secret's expiry.
	 * A test swaps it to move time.
	 */
	clock: () => Date = () => new Date();

	constructor(
		name: ConstructName<TName>,
		owner: string,
		options: WebhooksOptions<TEvents, TEvent>,
	) {
		const canonical = canonicalId(name as string);
		const offered = options.topic.eventTypes as readonly string[];
		for (const event of options.events ?? []) {
			if (!offered.includes(event)) {
				throw new WebhookEventNotOnTopic(event, options.topic.id);
			}
		}

		this.id = canonical as TName;
		this.owner = owner;
		this.topic = options.topic;
		this.eventTypes = [...(options.events ?? (offered as TEvent[]))];
		this.database = options.database;
		this.encryption = options.encryption;
		this.disableAfter = options.disableAfter ?? WEBHOOK_DISABLE_AFTER;
		this.events = new Topic(`${canonical}Events` as ConstructName<string>, {
			events: WEBHOOK_LIFECYCLE_EVENTS,
		}) as Topic<`${TName}Events`, WebhookLifecycleEvents>;
		this.reaches = [options.database, options.encryption, this.events];

		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: async (register) =>
				webhooksClient<TEvent>(this, await this.connect(register)),
		};
	}

	/**
	 * What delivering and managing need, registered: the tenant, the key, and
	 * the lifecycle topic's publisher — connected at its first publish, so a
	 * client that never publishes opens no broker connection, and a broker
	 * that can't be reached fails a publish (logged) rather than the client.
	 */
	async connect(register: ServiceRegisterOptions): Promise<WebhookDeps> {
		let publisher:
			| Promise<{ publish(messages: WebhookLifecycleMessage[]): Promise<void> }>
			| undefined;
		return {
			db: (await this.database.service.register(
				register,
			)) as unknown as Kysely<WebhookTables>,
			cipher: await this.encryption.service.register(register),
			publisher: {
				publish: async (messages) => {
					publisher ??= Promise.resolve(this.events.service.register(register));
					const connected = await publisher.catch((error) => {
						publisher = undefined;
						throw error;
					});
					await connected.publish(messages);
				},
			},
		};
	}

	declare(): Declaration[] {
		return [
			// Its lifecycle topic is its own, declared with it — as an inbox's.
			...this.events.declare(),
			{
				kind: 'webhooks',
				id: this.id,
				owner: this.owner,
				topic: this.topic.id,
				events: [...this.eventTypes],
				database: this.database.id,
				encryption: this.encryption.id,
			},
		];
	}

	/** What `gkm migration <id>` names its file when not given `--name`. */
	readonly migrationName = 'webhooks';

	/** The tenant its tables live in — where `gkm migration` writes them. */
	get databaseId(): string {
		return this.database.id;
	}

	/**
	 * The DDL its tenant is missing, or `undefined` when every table is there:
	 * what `gkm migration <id>` commits as the tenant's next migration.
	 * Compared as the owner, which may see what the runtime role may not.
	 */
	async pendingMigration(
		options: ServiceRegisterOptions,
	): Promise<string | undefined> {
		const db = (await this.database.owner.register(
			options,
		)) as unknown as Kysely<WebhookTables>;
		try {
			const present = await Promise.all(
				WEBHOOK_TABLES.map(async (table) => {
					const { rows } = await sql<{ found: string | null }>`
						select to_regclass(${table})::text as found
					`.execute(db);
					return rows[0]?.found != null;
				}),
			);
			return present.every(Boolean) ? undefined : WEBHOOK_TABLES_SQL;
		} finally {
			// Its own pool: left open, it keeps the process that asked alive.
			await db.destroy();
		}
	}
}
