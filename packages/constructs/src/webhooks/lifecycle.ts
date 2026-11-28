import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { TopicMessage } from '../topic/Topic';

/** What every delivery event says about the delivery it is about. */
export interface WebhookDeliveryRef {
	deliveryId: string;
	subscriptionId: string;
	owner: string;
	eventId: string;
	eventType: string;
}

/** A receiver accepted a delivery: it answered 2xx. */
export interface DeliverySucceeded extends WebhookDeliveryRef {
	/** The attempts it took, this one included. */
	attempts: number;
	status: number;
}

/** One attempt was not accepted — published once per failed attempt. */
export interface DeliveryFailed extends WebhookDeliveryRef {
	/** Which attempt this was, from 1. */
	attempt: number;
	/** What the receiver answered, or `null` when it never did. */
	status: number | null;
	error: string | null;
	/** When it is tried again (ISO 8601), or `null` when it will not be. */
	nextAttemptAt: string | null;
}

/** A delivery will not be tried again: its schedule ran out, or the receiver is gone. */
export interface DeliveryAbandoned extends WebhookDeliveryRef {
	attempts: number;
	lastStatus: number | null;
	lastError: string | null;
}

/** A subscription stopped receiving — by hand, a 410, or too many abandoned deliveries. */
export interface SubscriptionDisabled {
	subscriptionId: string;
	owner: string;
	reason: string;
}

/** A subscription's signing secret was replaced. */
export interface SecretRotated {
	subscriptionId: string;
	owner: string;
	/** Until when (ISO 8601) the old secret keeps signing beside the new one. */
	previousExpiresAt: string;
}

/**
 * A schema that takes a lifecycle payload as it is: this construct wrote it,
 * so there is nothing to check — and no validator is a dependency of the
 * runtime for it.
 */
function written<T>(): StandardSchemaV1<T> {
	return {
		'~standard': {
			version: 1,
			vendor: 'geekmidas',
			validate: (value) => ({ value: value as T }),
		},
	};
}

/**
 * The events a `Webhooks` construct publishes about itself, on the topic it
 * owns (`hooks.events`). Outside the delivery path: a subscriber that throws
 * never retries or duplicates a delivery.
 */
export const WEBHOOK_LIFECYCLE_EVENTS = {
	'delivery.succeeded': written<DeliverySucceeded>(),
	'delivery.failed': written<DeliveryFailed>(),
	'delivery.abandoned': written<DeliveryAbandoned>(),
	'subscription.disabled': written<SubscriptionDisabled>(),
	'secret.rotated': written<SecretRotated>(),
};

export type WebhookLifecycleEvents = typeof WEBHOOK_LIFECYCLE_EVENTS;

/** One message on a `Webhooks` construct's lifecycle topic. */
export type WebhookLifecycleMessage = TopicMessage<WebhookLifecycleEvents>;
