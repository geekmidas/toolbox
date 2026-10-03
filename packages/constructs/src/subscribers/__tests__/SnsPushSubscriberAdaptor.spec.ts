import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EnvironmentParser } from '@geekmidas/envkit';
import type { SnsHttpMessage } from '@geekmidas/events/sns';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { Topic } from '../../topic/Topic';
import { Worker } from '../../worker';
import { SnsPushSubscriberAdaptor } from '../SnsPushSubscriberAdaptor';

const TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:users';

const users = new Topic('Users', {
	events: {
		'user.created': z.object({ id: z.string() }),
		'user.updated': z.object({ id: z.string() }),
	},
});

function subscriberThatRecords() {
	const handled: unknown[] = [];
	const subscriber = new Worker('Jobs')
		.topic(users)
		.subscribe(['user.created'])
		.handle(async ({ events }) => {
			handled.push(...events);
		});
	return { subscriber, handled };
}

const notification = (
	overrides: Partial<SnsHttpMessage> = {},
): SnsHttpMessage => ({
	Type: 'Notification',
	MessageId: crypto.randomUUID(),
	TopicArn: TOPIC_ARN,
	Message: JSON.stringify({ type: 'user.created', payload: { id: 'u-1' } }),
	Timestamp: new Date().toISOString(),
	SignatureVersion: '1',
	// What the emulator sends: it signs nothing.
	Signature: 'EXAMPLE',
	SigningCertURL: 'EXAMPLE',
	MessageAttributes: { type: { Type: 'String', Value: 'user.created' } },
	...overrides,
});

const adaptor = (
	subscriber: ReturnType<typeof subscriberThatRecords>['subscriber'],
	verify = false,
) =>
	new SnsPushSubscriberAdaptor(new EnvironmentParser({}), subscriber, {
		topicArn: TOPIC_ARN,
		verify,
	});

describe('SnsPushSubscriberAdaptor', () => {
	it('runs a pushed notification through the subscriber, as Lambda would', async () => {
		const { subscriber, handled } = subscriberThatRecords();

		const response = await adaptor(subscriber).handle(notification());

		expect(response.status).toBe(200);
		expect(handled).toEqual([{ type: 'user.created', payload: { id: 'u-1' } }]);
	});

	it('refuses a message for a topic it is not subscribed to', async () => {
		const { subscriber, handled } = subscriberThatRecords();

		const response = await adaptor(subscriber).handle(
			notification({ TopicArn: 'arn:aws:sns:us-east-1:000000000000:other' }),
		);

		expect(response.status).toBe(403);
		expect(handled).toEqual([]);
	});

	it('refuses an unsigned message when verifying — what a forger would send', async () => {
		const { subscriber, handled } = subscriberThatRecords();

		const response = await adaptor(subscriber, true).handle(notification());

		expect(response).toMatchObject({
			status: 403,
			body: { error: 'SnsCertificateUntrusted' },
		});
		expect(handled).toEqual([]);
	});

	it('answers 500 when the handler fails, so SNS retries', async () => {
		const subscriber = new Worker('Jobs')
			.topic(users)
			.subscribe(['user.created'])
			.handle(async () => {
				throw new TypeError('database unavailable');
			});

		const response = await adaptor(subscriber).handle(notification());

		expect(response.status).toBe(500);
	});

	it('confirms through the emulator it was configured with, not the port the message names', async () => {
		// An emulator names itself by its port inside the container; the host
		// reaches it on whatever port was published.
		const hits: string[] = [];
		const emulator = createServer((req, res) => {
			hits.push(req.url ?? '');
			res.end('<ConfirmSubscriptionResponse/>');
		});
		await new Promise<void>((resolve) => emulator.listen(0, resolve));
		const { port } = emulator.address() as AddressInfo;

		try {
			const { subscriber } = subscriberThatRecords();
			const response = await new SnsPushSubscriberAdaptor(
				new EnvironmentParser({}),
				subscriber,
				{
					topicArn: TOPIC_ARN,
					verify: false,
					emulatorEndpoint: `http://localhost:${port}`,
				},
			).handle(
				notification({
					Type: 'SubscriptionConfirmation',
					Token: 'token-1',
					SubscribeURL:
						'http://localhost:4566/?Action=ConfirmSubscription&Token=token-1',
				}),
			);

			expect(response.status).toBe(200);
			expect(hits).toEqual(['/?Action=ConfirmSubscription&Token=token-1']);
		} finally {
			await new Promise((resolve) => emulator.close(resolve));
		}
	});

	it('refuses a body that is not an SNS message', async () => {
		const { subscriber } = subscriberThatRecords();

		expect((await adaptor(subscriber).handle({ hello: 1 })).status).toBe(400);
	});
});
