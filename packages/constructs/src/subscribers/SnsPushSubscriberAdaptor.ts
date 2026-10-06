import type { EnvironmentParser } from '@geekmidas/envkit';
import { wrapError } from '@geekmidas/errors';
import {
	confirmSnsSubscription,
	type SnsHttpMessage,
	toSnsEvent,
	verifySnsMessage,
} from '@geekmidas/events/sns';
import { runWithRequestContext } from '@geekmidas/services';
import {
	runSubscriber,
	subscribedEvents,
	subscriberContext,
} from './runSubscriber';
import type { Subscriber } from './Subscriber';

export interface SnsPushOptions {
	/** The topic this subscriber is subscribed to. Anything else is refused. */
	topicArn: string;
	/**
	 * Verify each message's signature. Off only against an emulator, which
	 * signs nothing — decided by the connection string's endpoint, never by
	 * anything the request says about itself.
	 */
	verify: boolean;
	/**
	 * The emulator's address, as this server was configured with it. An
	 * emulator names itself in `SubscribeURL` by the port it listens on inside
	 * its container, which is not the port published to the host — so against
	 * one, the confirmation is sent here instead. From configuration, never
	 * from the request.
	 */
	emulatorEndpoint?: string;
}

/** What to answer SNS with. A non-2xx tells SNS to retry. */
export interface SnsPushResponse {
	status: 200 | 400 | 403 | 500;
	body: { status: string; error?: string };
}

/**
 * A topic subscriber run by SNS pushing to an HTTP endpoint, rather than by a
 * poller.
 *
 * The notification is read as the Lambda event SNS would have invoked a
 * function with, and run through the same parsing, services and handler as the
 * Lambda adaptor — without its middy wrapper, which is Lambda's alone: a
 * server serving this route has no reason to install `@middy/core`.
 */
export class SnsPushSubscriberAdaptor {
	constructor(
		private readonly envParser: EnvironmentParser<{}>,
		readonly subscriber: Subscriber<any, any, any, any, any, any, any>,
		private readonly options: SnsPushOptions,
	) {}

	async handle(body: unknown): Promise<SnsPushResponse> {
		const message = body as SnsHttpMessage;
		if (typeof message?.Type !== 'string' || !message.TopicArn) {
			return refuse(400, 'not an SNS message');
		}
		// Checked before the signature: a genuine message for another topic is
		// still not this subscriber's to confirm or to handle.
		if (message.TopicArn !== this.options.topicArn) {
			return refuse(403, `not subscribed to ${message.TopicArn}`);
		}

		if (this.options.verify) {
			try {
				await verifySnsMessage(message);
			} catch (error) {
				this.subscriber.logger.warn(
					{ error, topicArn: message.TopicArn },
					'Refused an SNS message that did not verify',
				);
				return refuse(403, (error as Error).name);
			}
		}

		switch (message.Type) {
			case 'SubscriptionConfirmation':
				await confirmSnsSubscription(
					this.options.emulatorEndpoint && message.SubscribeURL
						? {
								...message,
								SubscribeURL: throughEndpoint(
									message.SubscribeURL,
									this.options.emulatorEndpoint,
								),
							}
						: message,
				);
				this.subscriber.logger.info(
					{ topicArn: message.TopicArn },
					'Confirmed SNS subscription',
				);
				return { status: 200, body: { status: 'confirmed' } };
			case 'Notification':
				try {
					await this.notify(message);
					return { status: 200, body: { status: 'ok' } };
				} catch (error) {
					// Already logged. A 500 makes SNS retry, which is the point of
					// answering at all.
					return refuse(500, (error as Error).name);
				}
			default:
				return { status: 200, body: { status: 'ignored' } };
		}
	}

	private async notify(message: SnsHttpMessage): Promise<void> {
		const requestId = message.MessageId;
		const logger = this.subscriber.logger.child({ requestId });

		await runWithRequestContext(
			{
				logger,
				requestId,
				startTime: Date.now(),
				operation: `subscriber ${this.subscriber.topicName ?? 'sns'}`,
			},
			async () => {
				try {
					const { services, db } = await subscriberContext(
						this.subscriber,
						this.envParser,
					);
					const events = subscribedEvents(
						this.subscriber,
						toSnsEvent(message),
						logger,
					);
					await runSubscriber(this.subscriber, {
						events,
						services,
						logger,
						db,
					});
				} catch (error) {
					logger.error(error as object, 'Error processing subscriber');
					throw wrapError(error);
				}
			},
		);
	}
}

/** `url`, sent to `endpoint`'s origin instead of its own. */
function throughEndpoint(url: string, endpoint: string): string {
	const target = new URL(url);
	const origin = new URL(endpoint);
	target.protocol = origin.protocol;
	target.host = origin.host;
	return target.toString();
}

function refuse(
	status: SnsPushResponse['status'],
	error: string,
): SnsPushResponse {
	return { status, body: { status: 'refused', error } };
}
