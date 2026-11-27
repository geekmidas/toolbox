/**
 * Webhooks — the requests a service sends to its users' endpoints.
 *
 * A `Topic` already declares each event it carries and the schema of its
 * payload. A service that delivers those events to URLs its users register
 * says so on the surface that documents it:
 *
 * ```ts
 * export const api = new RestApi('Api', { path: 'apps/api' }).webhooks(users, {
 *   signature: {
 *     header: 'Webhook-Signature',
 *     description: 'HMAC-SHA256 of the raw body with the endpoint secret',
 *   },
 * });
 * ```
 *
 * and the OpenAPI document lists each event under `webhooks` (OpenAPI 3.1) —
 * the body the receiver is sent, `{ type, payload }`, and the header that
 * proves it came from this service.
 *
 * The list lives on the surface, which every endpoint built from it carries by
 * reference, so the document — which only ever sees endpoints — finds it
 * there. Registering a topic after the endpoints were built still reaches
 * them.
 */
import { convertSchemaWithComponents } from '@geekmidas/schema/conversion';
import {
	type ComponentCollector,
	createComponentCollector,
} from '@geekmidas/schema/openapi';
import type { OpenAPIV3_1 } from 'openapi-types';
import type { Topic, TopicEvents } from '../topic/Topic';

/** The header a receiver checks to know a delivery came from this service. */
export interface WebhookSignature {
	/** The header's name — `Webhook-Signature`, `X-Hub-Signature-256`. */
	header: string;
	/** How the signature is computed, and how a receiver verifies it. */
	description?: string;
}

/** What `api.webhooks(topic, options)` says about a topic's deliveries. */
export interface WebhookOptions<TEvents extends TopicEvents = TopicEvents> {
	/** The header each delivery is signed with. */
	signature?: WebhookSignature;
	/** Said of every event delivered from this topic. */
	description?: string;
	/**
	 * The events that are delivered, when not all of them are. A topic can
	 * carry events that never leave the service.
	 */
	events?: readonly (keyof TEvents & string)[];
}

/** A topic whose events are delivered to subscriber URLs. */
export interface Webhook {
	topic: Topic<string, TopicEvents>;
	options: WebhookOptions;
}

/**
 * Two topics delivered as webhooks carry an event of the same type.
 *
 * `webhooks` is keyed by event type — it is what a receiver switches on — so
 * the second would replace the first in the document.
 */
export class WebhookEventDeclaredTwice extends Error {
	constructor(
		readonly type: string,
		readonly topics: readonly [string, string],
	) {
		super(
			`Webhook event '${type}' is carried by both '${topics[0]}' and '${topics[1]}'. ` +
				'A receiver tells events apart by type, so rename one of them, or ' +
				"leave it out of one topic's deliveries with `events: [...]`.",
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

/**
 * Records `topic` in `webhooks`, replacing what an earlier call said about the
 * same topic. Mutates in place: the list is shared by every endpoint the
 * surface built.
 */
export function registerWebhook(
	webhooks: Webhook[],
	topic: Topic<string, any>,
	options: WebhookOptions = {},
): void {
	for (const type of options.events ?? []) {
		if (!(type in topic.eventSchemas)) {
			throw new WebhookEventNotOnTopic(type, topic.name);
		}
	}

	const existing = webhooks.findIndex((w) => w.topic === topic);
	const webhook: Webhook = { topic, options };
	if (existing >= 0) {
		webhooks[existing] = webhook;
	} else {
		webhooks.push(webhook);
	}
}

/**
 * The webhooks of every surface the endpoints came from, each topic once.
 */
export function webhooksOf(
	endpoints: ReadonlyArray<{ surface?: { webhooks?: Webhook[] } }>,
): Webhook[] {
	const lists = new Set<Webhook[]>();
	for (const endpoint of endpoints) {
		if (endpoint.surface?.webhooks) lists.add(endpoint.surface.webhooks);
	}

	const byTopic = new Map<Topic<string, TopicEvents>, Webhook>();
	for (const list of lists) {
		for (const webhook of list) byTopic.set(webhook.topic, webhook);
	}
	return [...byTopic.values()];
}

/**
 * The OpenAPI `webhooks` object for `webhooks`: one POST per event, keyed by
 * its type.
 */
export async function buildOpenApiWebhooks(
	webhooks: readonly Webhook[],
	collector?: ComponentCollector,
): Promise<Record<string, OpenAPIV3_1.PathItemObject>> {
	const document: Record<string, OpenAPIV3_1.PathItemObject> = {};
	const carriedBy = new Map<string, string>();

	for (const { topic, options } of webhooks) {
		const types = options.events ?? topic.eventTypes;

		for (const type of types) {
			const other = carriedBy.get(type);
			if (other !== undefined) {
				throw new WebhookEventDeclaredTwice(type, [other, topic.name]);
			}
			carriedBy.set(type, topic.name);

			const payload = await convertSchemaWithComponents(
				topic.eventSchemas[type],
				collector,
			);

			const operation: OpenAPIV3_1.OperationObject = {
				operationId: webhookOperationId(type),
				summary: `${topic.name}: ${type}`,
				...(options.description && { description: options.description }),
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									type: { type: 'string', const: type },
									payload: payload ?? {},
								},
								required: ['type', 'payload'],
							} as OpenAPIV3_1.SchemaObject,
						},
					},
				},
				responses: {
					'2XX': {
						description:
							'Delivered. Any other status, or no answer, is a failed delivery.',
					},
				},
			};

			if (options.signature) {
				operation.parameters = [
					{
						name: options.signature.header,
						in: 'header',
						required: true,
						...(options.signature.description && {
							description: options.signature.description,
						}),
						schema: { type: 'string' },
					},
				];
			}

			// openapi-types types a 3.1 path item's operations as 3.0 ones.
			document[type] = { post: operation } as OpenAPIV3_1.PathItemObject;
		}
	}

	return document;
}

/**
 * `doc` with the webhooks of the surfaces `endpoints` came from — the schemas
 * their payloads name added to its components.
 */
export async function withWebhooks(
	doc: OpenAPIV3_1.Document,
	endpoints: ReadonlyArray<{ surface?: { webhooks?: Webhook[] } }>,
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
