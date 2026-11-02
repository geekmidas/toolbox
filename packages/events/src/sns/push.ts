import {
	ConfirmSubscriptionCommand,
	GetSubscriptionAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SetSubscriptionAttributesCommand,
	SubscribeCommand,
	type SubscribeCommandInput,
	UnsubscribeCommand,
} from '@aws-sdk/client-sns';
import { parseUrl, type SnsHttpMessage, SnsNotAConfirmation } from './message';
import type { SNSConnection } from './SNSConnection';

/**
 * Subscribing an HTTP(S) endpoint to a topic, which takes the SNS API and so
 * the AWS SDK. Receiving what SNS then pushes takes neither: that is
 * `./message`, the `@geekmidas/events/sns/message` entry.
 */

/** Where a subscription's filter policy is matched. */
export type SnsFilterPolicyScope = 'MessageAttributes' | 'MessageBody';

/** What an HTTP subscription is created or brought up to date with. */
export interface HttpSubscriptionFilter {
	/**
	 * The event types this endpoint takes. Becomes the subscription's filter
	 * policy on the `type` attribute `SNSPublisher` sets, so SNS sends nothing
	 * else — fan-out to every subscriber, each seeing only what it named.
	 *
	 * Absent, with no {@link filterPolicy} either, for a topic whose
	 * publisher sets no `type` — a bucket's — whose subscriber filters what it
	 * is sent.
	 *
	 * Ignored when {@link filterPolicy} is given.
	 */
	events?: readonly string[];
	/**
	 * A filter policy of the caller's own, for messages SNS did not receive
	 * from `SNSPublisher` — a bucket's notifications carry no `type` attribute,
	 * so they are matched on their body instead.
	 */
	filterPolicy?: Record<string, unknown>;
	/** Where {@link filterPolicy} is matched. `MessageAttributes` by default. */
	filterPolicyScope?: SnsFilterPolicyScope;
	/**
	 * An SQS queue's ARN for what SNS gives up delivering. SNS retries an HTTP
	 * endpoint for a limited time and then drops the message, so without one an
	 * outage longer than that loses events.
	 */
	deadLetterQueueArn?: string;
}

export interface SubscribeHttpEndpointOptions extends HttpSubscriptionFilter {
	/** The URL SNS POSTs to — `http:` or `https:`, which picks the protocol. */
	endpoint: string;
}

/** The subscription attributes a filter asks for, as SNS spells them. */
function subscriptionAttributes(
	filter: HttpSubscriptionFilter,
): Record<string, string> {
	const attributes: Record<string, string> = filter.filterPolicy
		? {
				FilterPolicyScope: filter.filterPolicyScope ?? 'MessageAttributes',
				FilterPolicy: JSON.stringify(filter.filterPolicy),
			}
		: filter.events
			? {
					FilterPolicyScope: 'MessageAttributes',
					FilterPolicy: JSON.stringify({ type: [...filter.events] }),
				}
			: {};
	if (filter.deadLetterQueueArn) {
		attributes.RedrivePolicy = JSON.stringify({
			deadLetterTargetArn: filter.deadLetterQueueArn,
		});
	}
	return attributes;
}

/** The protocol SNS delivers to an endpoint with, from its URL. */
function protocolOf(endpoint: string): 'http' | 'https' {
	const protocol = parseUrl(endpoint)?.protocol.replace(':', '');
	if (protocol !== 'http' && protocol !== 'https') {
		throw new SnsEndpointNotHttp(endpoint);
	}
	return protocol;
}

/** Bring an existing subscription's attributes up to what is asked for. */
async function updateAttributes(
	connection: SNSConnection,
	subscriptionArn: string,
	current: Record<string, string>,
	wanted: Record<string, string>,
): Promise<void> {
	for (const [name, value] of Object.entries(wanted)) {
		if (current[name] === value) continue;
		await connection.snsClient.send(
			new SetSubscriptionAttributesCommand({
				SubscriptionArn: subscriptionArn,
				AttributeName: name,
				AttributeValue: value,
			}),
		);
	}
}

/**
 * Subscribe an HTTP endpoint to the connection's topic, converging on one
 * confirmed subscription with the filter asked for — so it is safe on every
 * start. What a server does against an emulator, where nothing deploys it;
 * against SNS itself the deploy owns the subscription
 * ({@link reconcileHttpSubscriptions}).
 *
 * - **none yet** — subscribed; SNS sends a confirmation to the endpoint.
 * - **confirmed** — its filter and dead-letter queue are brought up to date.
 *   Subscribing again with different attributes is an error on SNS, and the
 *   events a subscriber names change.
 * - **stuck pending** — a confirmation that never landed (the endpoint was
 *   down, or answered wrong). Subscribing the same endpoint again is a no-op
 *   on an emulator, so it is dropped and subscribed afresh, which sends a new
 *   confirmation.
 */
export async function subscribeHttpEndpoint(
	connection: SNSConnection,
	options: SubscribeHttpEndpointOptions,
): Promise<string | undefined> {
	const protocol = protocolOf(options.endpoint);
	const attributes = subscriptionAttributes(options);

	const client = connection.snsClient;
	const existing = (await topicSubscriptions(connection)).find(
		(s) => s.endpoint === options.endpoint,
	)?.arn;
	if (existing) {
		const { Attributes = {} } = await client.send(
			new GetSubscriptionAttributesCommand({ SubscriptionArn: existing }),
		);
		if (Attributes.PendingConfirmation === 'true') {
			await client.send(new UnsubscribeCommand({ SubscriptionArn: existing }));
		} else {
			await updateAttributes(connection, existing, Attributes, attributes);
			return existing;
		}
	}

	const { SubscriptionArn } = await client.send(
		new SubscribeCommand({
			TopicArn: connection.topicArn,
			Protocol: protocol,
			Endpoint: options.endpoint,
			Attributes: attributes as SubscribeCommandInput['Attributes'],
			ReturnSubscriptionArn: true,
		}),
	);
	return SubscriptionArn;
}

/** One endpoint the deploy wants subscribed, under the name it is recorded by. */
export interface HttpSubscriptionSpec extends HttpSubscriptionFilter {
	/** What the ARN is recorded under — the subscriber's export. */
	name: string;
	/** The URL SNS POSTs to. */
	endpoint: string;
}

export interface ReconcileHttpSubscriptionsOptions {
	/** Every endpoint that should be subscribed to the topic. */
	endpoints: readonly HttpSubscriptionSpec[];
	/**
	 * The host these endpoints answer on. A subscription to an endpoint on it
	 * that is not in {@link endpoints} — a subscriber renamed or removed — is
	 * unsubscribed; anything subscribed on another host is somebody else's and
	 * left alone.
	 */
	ownedHost: string;
}

export interface ReconciledHttpSubscriptions {
	/** Each endpoint's subscription ARN, by its name — stable across runs. */
	subscriptions: Record<string, string>;
	/** The names whose subscription SNS still waits to have confirmed. */
	pending: string[];
	/** The ARNs of what was unsubscribed as no longer wanted. */
	removed: string[];
}

/**
 * Converge a topic's HTTP subscriptions on the endpoints a deploy wants, and
 * answer each one's ARN for the deploy to record and hand to the server.
 *
 * The deploy's half of push delivery against SNS itself: the server never
 * subscribes, so its credentials need no `sns:Subscribe` — and the only
 * subscriptions to the topic are ones the deploy made.
 *
 * Run it twice: once before the server starts, for the ARNs it is configured
 * with — SNS answers one even while the subscription waits to be confirmed —
 * and once the server is up, which subscribes each still-pending endpoint
 * again so SNS resends its confirmation to a server now there to answer it.
 * The ARN does not change between the two.
 *
 * - **absent** — subscribed with its filter.
 * - **present** — its filter and dead-letter queue are brought up to date;
 *   pending, it is subscribed again to resend the confirmation.
 * - **stale** — on {@link ReconcileHttpSubscriptionsOptions.ownedHost} and no
 *   longer wanted: unsubscribed. (A stale one SNS still lists as pending has
 *   no ARN to act on; SNS drops it unconfirmed after three days.)
 */
export async function reconcileHttpSubscriptions(
	connection: SNSConnection,
	options: ReconcileHttpSubscriptionsOptions,
): Promise<ReconciledHttpSubscriptions> {
	const client = connection.snsClient;
	const listed = await topicSubscriptions(connection);
	const result: ReconciledHttpSubscriptions = {
		subscriptions: {},
		pending: [],
		removed: [],
	};

	for (const spec of options.endpoints) {
		const protocol = protocolOf(spec.endpoint);
		const attributes = subscriptionAttributes(spec);
		const subscribe = async () =>
			(
				await client.send(
					new SubscribeCommand({
						TopicArn: connection.topicArn,
						Protocol: protocol,
						Endpoint: spec.endpoint,
						Attributes: attributes as SubscribeCommandInput['Attributes'],
						ReturnSubscriptionArn: true,
					}),
				)
			).SubscriptionArn;

		const existing = listed.find((s) => s.endpoint === spec.endpoint)?.arn;
		let arn: string | undefined;
		let pending: boolean;
		if (existing) {
			const { Attributes = {} } = await client.send(
				new GetSubscriptionAttributesCommand({ SubscriptionArn: existing }),
			);
			await updateAttributes(connection, existing, Attributes, attributes);
			pending = Attributes.PendingConfirmation === 'true';
			// Subscribing a pending endpoint again resends its confirmation,
			// under the same ARN.
			arn = pending ? ((await subscribe()) ?? existing) : existing;
		} else {
			// Absent — or pending on SNS itself, which lists it with no ARN:
			// subscribing answers the one it has, and resends the confirmation.
			arn = await subscribe();
			pending = true;
		}
		if (!arn) {
			throw new SnsSubscriptionArnMissing(connection.topicArn, spec.endpoint);
		}

		result.subscriptions[spec.name] = arn;
		if (pending) result.pending.push(spec.name);
	}

	const wanted = new Set(options.endpoints.map((spec) => spec.endpoint));
	for (const { arn, endpoint } of listed) {
		if (!arn || wanted.has(endpoint)) continue;
		if (parseUrl(endpoint)?.host !== options.ownedHost) continue;
		await client.send(new UnsubscribeCommand({ SubscriptionArn: arn }));
		result.removed.push(arn);
	}

	return result;
}

/**
 * Confirm a subscription through the API, as its topic's owner, rather than by
 * visiting the URL SNS sent.
 *
 * `AuthenticateOnUnsubscribe` is the point of it. A subscription confirmed by
 * visiting `SubscribeURL` can be removed by anyone holding the
 * `UnsubscribeURL` every notification carries — one unauthenticated GET, and
 * the endpoint is silently cut off. Confirmed this way, only the topic's owner
 * can unsubscribe it. All it takes of the caller's credentials is
 * `sns:ConfirmSubscription` on this one topic.
 */
export async function confirmSubscription(
	connection: SNSConnection,
	message: SnsHttpMessage,
): Promise<string | undefined> {
	if (message.Type !== 'SubscriptionConfirmation' || !message.Token) {
		throw new SnsNotAConfirmation(message.Type);
	}

	const { SubscriptionArn } = await connection.snsClient.send(
		new ConfirmSubscriptionCommand({
			TopicArn: message.TopicArn,
			Token: message.Token,
			AuthenticateOnUnsubscribe: 'true',
		}),
	);
	return SubscriptionArn;
}

/**
 * Every subscription on the connection's topic, with the ARN SNS names for it
 * — none for one real SNS lists as `PendingConfirmation`, which there is no
 * ARN to act on (and which a new Subscribe resends the confirmation of anyway).
 */
async function topicSubscriptions(
	connection: SNSConnection,
): Promise<{ arn?: string; endpoint: string }[]> {
	const found: { arn?: string; endpoint: string }[] = [];
	let NextToken: string | undefined;
	do {
		const page = await connection.snsClient.send(
			new ListSubscriptionsByTopicCommand({
				TopicArn: connection.topicArn,
				NextToken,
			}),
		);
		for (const s of page.Subscriptions ?? []) {
			if (!s.Endpoint) continue;
			found.push({
				endpoint: s.Endpoint,
				...(s.SubscriptionArn?.startsWith('arn:')
					? { arn: s.SubscriptionArn }
					: {}),
			});
		}
		NextToken = page.NextToken;
	} while (NextToken);
	return found;
}

export class SnsEndpointNotHttp extends Error {
	constructor(readonly endpoint: string) {
		super(
			`'${endpoint}' is not an http(s) URL. SNS pushes to an HTTP endpoint; ` +
				'subscribe a queue for anything else.',
		);
		this.name = 'SnsEndpointNotHttp';
	}
}

export class SnsSubscriptionArnMissing extends Error {
	constructor(
		readonly topicArn: string,
		readonly endpoint: string,
	) {
		super(
			`Subscribing '${endpoint}' to '${topicArn}' answered no subscription ` +
				'ARN, so there is nothing to record for the server to accept. ' +
				'Check the topic exists and the deploy may subscribe to it.',
		);
		this.name = 'SnsSubscriptionArnMissing';
	}
}
