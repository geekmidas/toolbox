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
import type { Topic, TopicEvents } from '../topic/Topic';
import { type WebhooksClient, webhooksClient } from './client';
import {
	WEBHOOK_TABLES,
	WEBHOOK_TABLES_SQL,
	type WebhookTables,
} from './schema';
import { fetchTransport, type WebhookTransport } from './transport';

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
	/** The events delivered, in the order given. */
	readonly events: readonly TEvent[];
	readonly database: KyselyDatabase<any, any>;
	readonly encryption: Encryption;
	/**
	 * What a runnable depending on this reaches through it — and so is given
	 * an edge to, beside this one.
	 */
	readonly reaches: readonly Consumable[];
	/** How a delivery's request leaves the process. A test swaps it. */
	transport: WebhookTransport = fetchTransport;
	/**
	 * The time everything it schedules is reckoned by — when a delivery is
	 * next due, when a rotated secret stops signing. A test swaps it.
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
		this.events = [...(options.events ?? (offered as TEvent[]))];
		this.database = options.database;
		this.encryption = options.encryption;
		this.reaches = [options.database, options.encryption];

		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: async (register) =>
				webhooksClient<TEvent>({
					id: this.id,
					events: this.events,
					db: (await this.database.service.register(
						register,
					)) as unknown as Kysely<WebhookTables>,
					cipher: await this.encryption.service.register(register),
					now: () => this.clock(),
				}),
		};
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'webhooks',
				id: this.id,
				owner: this.owner,
				topic: this.topic.id,
				events: [...this.events],
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
