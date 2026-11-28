/**
 * Webhooks in the OpenAPI document — the requests a service sends to the URLs
 * its users register.
 *
 * Ownership decides the document. `api.webhooks('BillingHooks', …)` builds a
 * `Webhooks` construct owned by `api`, and records it on the surface every
 * endpoint built from `api` carries by reference. The document — which only
 * ever sees endpoints — finds it there, so it lists the webhooks of the APIs
 * its endpoints were built from, and no others: an endpoint on another API
 * that `.dependsOn([billingHooks])` to manage the subscriptions does not make
 * that API's document list them.
 *
 * Each delivered event is a `POST` under the document's `webhooks` (OpenAPI
 * 3.1): the envelope a receiver is actually sent, the three Standard Webhooks
 * headers it verifies the signature by, and what its answer makes the sender
 * do next.
 */
import { convertSchemaWithComponents } from '@geekmidas/schema/conversion';
import {
	type ComponentCollector,
	createComponentCollector,
} from '@geekmidas/schema/openapi';
import type { OpenAPIV3_1 } from 'openapi-types';
import type { TopicEvents } from '../topic/Topic';
import type { Webhooks } from '../webhooks/Webhooks';

/**
 * Two `Webhooks` documented together deliver an event of the same type.
 *
 * `webhooks` is keyed by event type — it is what a receiver switches on — so
 * the second would replace the first in the document.
 */
export class WebhookEventDeclaredTwice extends Error {
	constructor(
		readonly type: string,
		readonly webhooks: readonly [string, string],
	) {
		super(
			`Webhook event '${type}' is delivered by both '${webhooks[0]}' and '${webhooks[1]}'. ` +
				'A receiver tells events apart by type, so rename one of them, or ' +
				'leave it out of one of their deliveries with `events: [...]`.',
		);
		this.name = 'WebhookEventDeclaredTwice';
	}
}

/**
 * A webhook names an event its topic does not carry.
 */
export class WebhookEventNotOnTopic extends Error {
	constructor(
		readonly type: string,
		readonly topic: string,
	) {
		super(
			`'${type}' is not an event of topic '${topic}'. ` +
				`Name one of its events in \`events\`, or add '${type}' to the topic.`,
		);
		this.name = 'WebhookEventNotOnTopic';
	}
}

/** A `Webhooks` construct, whatever its topic's events. */
export type OwnedWebhooks = Webhooks<string, any, any>;

/** One event a receiver can be sent, and the construct that delivers it. */
export interface DeliveredWebhookEvent {
	/** The event's type — `invoice.paid`. */
	type: string;
	/** The `Webhooks` construct that delivers it. */
	webhooks: OwnedWebhooks;
	/** The schema of its payload, from the topic. */
	payload: TopicEvents[string] | undefined;
}

/**
 * The event types `hooks` delivers.
 *
 * Read through here rather than `hooks.events`: the delivered list is being
 * renamed `eventTypes`, with `events` becoming the construct's lifecycle
 * `Topic`. Preferring `eventTypes`, and taking `events` only when it is the
 * array it used to be, reads the list correctly on either side of that change.
 */
export function deliveredEventTypes(hooks: OwnedWebhooks): readonly string[] {
	const { eventTypes, events } = hooks as unknown as {
		eventTypes?: unknown;
		events?: unknown;
	};
	if (Array.isArray(eventTypes)) return eventTypes as string[];
	if (Array.isArray(events)) return events as string[];
	return [];
}

/**
 * Records `hooks` in `owned` — the list a surface shares with every endpoint
 * it built — refusing an event type another construct there already delivers.
 * Mutates in place, so endpoints built before it still reach it.
 */
export function ownWebhooks(
	owned: OwnedWebhooks[],
	hooks: OwnedWebhooks,
): void {
	webhookEvents([...owned, hooks]);
	owned.push(hooks);
}

/**
 * The `Webhooks` owned by every surface the endpoints came from, each once.
 */
export function webhooksOf(
	endpoints: ReadonlyArray<{
		surface?: { webhooks?: readonly OwnedWebhooks[] };
	}>,
): OwnedWebhooks[] {
	const owned = new Set<OwnedWebhooks>();
	for (const endpoint of endpoints) {
		for (const hooks of endpoint.surface?.webhooks ?? []) owned.add(hooks);
	}
	return [...owned];
}

/**
 * Every event `webhooks` deliver, in order, with its payload schema — refusing
 * one delivered by two of them, which a receiver could not tell apart.
 */
export function webhookEvents(
	webhooks: readonly OwnedWebhooks[],
): DeliveredWebhookEvent[] {
	const events: DeliveredWebhookEvent[] = [];
	const deliveredBy = new Map<string, string>();

	for (const hooks of webhooks) {
		for (const type of deliveredEventTypes(hooks)) {
			const other = deliveredBy.get(type);
			if (other !== undefined) {
				throw new WebhookEventDeclaredTwice(type, [other, hooks.id]);
			}
			deliveredBy.set(type, hooks.id);
			events.push({
				type,
				webhooks: hooks,
				payload: (hooks.topic.eventSchemas as TopicEvents)[type],
			});
		}
	}

	return events;
}

/** How a delivery is retried, and what a receiver's answer means. */
export const WEBHOOK_DELIVERY_DESCRIPTION = [
	'Sent as a signed `POST` to each URL subscribed to this event.',
	'',
	'A delivery is attempted immediately, then retried after 1m, 5m, 30m, 2h, ' +
		'5h, 10h and 10h.',
	'',
	'- A `2xx` answer accepts the delivery; nothing more is sent.',
	'- A `410 Gone` answer disables the subscription: nothing more is sent to ' +
		'this URL until it is enabled again.',
	'- Anything else (another status, a timeout, no answer) is retried.',
	'- Redirects are not followed: a `3xx` is a failed attempt.',
	'',
	'The same delivery can arrive more than once. `webhook-id` is the same on ' +
		'every attempt, so a receiver can drop one it has already processed.',
].join('\n');

/** The Standard Webhooks headers every delivery carries. */
export const WEBHOOK_HEADERS: readonly OpenAPIV3_1.ParameterObject[] = [
	{
		name: 'webhook-id',
		in: 'header',
		required: true,
		description:
			"This delivery's id — one per subscription, the same on every " +
			'attempt. What a receiver deduplicates on.',
		schema: { type: 'string' },
	},
	{
		name: 'webhook-timestamp',
		in: 'header',
		required: true,
		description:
			'When this attempt was sent, in unix seconds. Reject a request whose ' +
			'timestamp is far from now, so a captured one cannot be replayed.',
		schema: { type: 'integer' },
	},
	{
		name: 'webhook-signature',
		in: 'header',
		required: true,
		description:
			'`v1,<signature>`: the base64 HMAC-SHA256 of ' +
			'`<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the ' +
			"subscription's secret. While a secret is being rotated several are " +
			'sent, space-separated; the request is genuine if any one matches.',
		schema: { type: 'string' },
	},
];

/**
 * The OpenAPI `webhooks` object for `webhooks`: one POST per delivered event,
 * keyed by its type.
 */
export async function buildOpenApiWebhooks(
	webhooks: readonly OwnedWebhooks[],
	collector?: ComponentCollector,
): Promise<Record<string, OpenAPIV3_1.PathItemObject>> {
	const document: Record<string, OpenAPIV3_1.PathItemObject> = {};

	for (const event of webhookEvents(webhooks)) {
		const payload = event.payload
			? await convertSchemaWithComponents(event.payload, collector)
			: undefined;

		const operation: OpenAPIV3_1.OperationObject = {
			operationId: webhookOperationId(event.type),
			summary: `${event.webhooks.id}: ${event.type}`,
			description: WEBHOOK_DELIVERY_DESCRIPTION,
			parameters: WEBHOOK_HEADERS.map((header) => ({ ...header })),
			requestBody: {
				required: true,
				content: {
					'application/json': {
						schema: {
							type: 'object',
							properties: {
								id: {
									type: 'string',
									description:
										"The event's id — the same in every subscription's " +
										'delivery of this occurrence of it.',
								},
								type: { type: 'string', const: event.type },
								occurredAt: { type: 'string', format: 'date-time' },
								payload: payload ?? {},
							},
							required: ['id', 'type', 'occurredAt', 'payload'],
						} as OpenAPIV3_1.SchemaObject,
					},
				},
			},
			responses: {
				'2XX': { description: 'Accepted: the delivery is done.' },
				'410': {
					description:
						'Gone: stop sending to this URL. The subscription is disabled.',
				},
			},
		};

		// openapi-types types a 3.1 path item's operations as 3.0 ones.
		document[event.type] = { post: operation } as OpenAPIV3_1.PathItemObject;
	}

	return document;
}

/**
 * `doc` with the webhooks owned by the surfaces `endpoints` came from — the
 * schemas their payloads name added to its components.
 */
export async function withWebhooks(
	doc: OpenAPIV3_1.Document,
	endpoints: ReadonlyArray<{
		surface?: { webhooks?: readonly OwnedWebhooks[] };
	}>,
): Promise<OpenAPIV3_1.Document> {
	const webhooks = webhooksOf(endpoints);
	if (webhooks.length === 0) return doc;

	const collector = createComponentCollector();
	const documented = await buildOpenApiWebhooks(webhooks, collector);
	if (Object.keys(documented).length === 0) return doc;

	const schemas = { ...doc.components?.schemas, ...collector.schemas };

	return {
		...doc,
		webhooks: documented,
		...(Object.keys(schemas).length > 0 && {
			components: { ...doc.components, schemas },
		}),
	};
}

/** `user.created` → `userCreatedWebhook`. */
function webhookOperationId(type: string): string {
	const words = type.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	const camel = words
		.map((word, i) =>
			i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1),
		)
		.join('');
	return `${camel}Webhook`;
}
