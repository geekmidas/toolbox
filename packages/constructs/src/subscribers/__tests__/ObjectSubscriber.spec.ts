import { EnvironmentParser } from '@geekmidas/envkit';
import type { SnsHttpMessage } from '@geekmidas/events/sns';
import type { ObjectEvent, ObjectMessage } from '@geekmidas/storage/events';
import type { Context, SNSEvent, SQSEvent } from 'aws-lambda';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ObjectStorage } from '../../object-storage';
import { Worker } from '../../worker';
import { AWSLambdaSubscriber } from '../AWSLambdaSubscriberAdaptor';
import { ObjectSubscriberHasNoEvents } from '../ObjectSubscriberBuilder';
import { SnsPushSubscriberAdaptor } from '../SnsPushSubscriberAdaptor';
import { TestSubscriberAdaptor } from '../TestSubscriberAdaptor';

const TOPIC_ARN = 'arn:aws:sns:eu-west-1:000000000000:acme-uploads-events';

const uploads = new ObjectStorage('Uploads');
const worker = new Worker('Jobs');

/** What S3 publishes to the bucket's topic when objects change. */
function s3Notification(
	...records: { eventName: string; key: string; size?: number }[]
): string {
	return JSON.stringify({
		Records: records.map(({ eventName, key, size }) => ({
			eventVersion: '2.1',
			eventSource: 'aws:s3',
			eventName,
			s3: {
				bucket: { name: 'acme-uploads' },
				object: { key, ...(size !== undefined ? { size, eTag: '"e1"' } : {}) },
			},
		})),
	});
}

function avatarSubscriber() {
	const handled: ObjectEvent[] = [];
	const subscriber = worker
		.objects(uploads)
		.on(['object.created'], { prefix: 'avatars/', suffix: '.png' })
		.handle(async ({ objects }) => {
			handled.push(...objects);
		});
	return { subscriber, handled };
}

const lambdaContext = {
	awsRequestId: 'req-1',
	functionName: 'onAvatar',
	functionVersion: '1',
	memoryLimitInMB: '128',
} as unknown as Context;

describe('worker.objects()', () => {
	it('builds a subscriber bound to the bucket, owned by the worker', () => {
		const { subscriber } = avatarSubscriber();

		expect(subscriber.bucketName).toBe('Uploads');
		expect(subscriber.objectFilter).toEqual({
			prefix: 'avatars/',
			suffix: '.png',
		});
		expect(subscriber.subscribedEvents).toEqual(['object.created']);
		expect(subscriber.owner).toBe('Jobs');
		// Not a topic subscriber: nothing for a topic to route.
		expect(subscriber.topicName).toBeUndefined();
	});

	it('hands the handler typed objects and their events', () => {
		worker
			.objects(uploads)
			.on(['object.created', 'object.deleted'])
			.handle(async ({ objects, events }) => {
				expectTypeOf(objects).toEqualTypeOf<ObjectEvent[]>();
				expectTypeOf(events).toEqualTypeOf<
					ObjectMessage<'object.created' | 'object.deleted'>[]
				>();
			});
	});

	it('gives the handler the services it depends on, and the worker its database edge', () => {
		const subscriber = worker
			.objects(uploads)
			.dependsOn([uploads])
			.on(['object.created'])
			.handle(async ({ services }) => {
				expectTypeOf(services).toHaveProperty('uploads');
			});

		expect(subscriber.constructs).toEqual(['Uploads']);
	});

	it('refuses a subscriber that names no event', () => {
		expect(() => worker.objects(uploads).handle(async () => {})).toThrow(
			ObjectSubscriberHasNoEvents,
		);
	});
});

describe('an object subscriber, pushed to by SNS', () => {
	const adaptor = (
		subscriber: ReturnType<typeof avatarSubscriber>['subscriber'],
	) =>
		new SnsPushSubscriberAdaptor(new EnvironmentParser({}), subscriber, {
			topicArn: TOPIC_ARN,
			verify: false,
		});
	const notification = (message: string): SnsHttpMessage => ({
		Type: 'Notification',
		MessageId: crypto.randomUUID(),
		TopicArn: TOPIC_ARN,
		// S3 publishes the notification as the message, with no attributes.
		Message: message,
		Timestamp: new Date().toISOString(),
		SignatureVersion: '1',
		Signature: 'EXAMPLE',
		SigningCertURL: 'EXAMPLE',
	});

	it('reads what S3 sends as objects, keeping only the keys it watches', async () => {
		const { subscriber, handled } = avatarSubscriber();

		const response = await adaptor(subscriber).handle(
			notification(
				s3Notification(
					{
						eventName: 'ObjectCreated:Put',
						key: 'avatars/me+too.png',
						size: 7,
					},
					{ eventName: 'ObjectCreated:Put', key: 'avatars/me.jpg', size: 1 },
					{ eventName: 'ObjectCreated:Put', key: 'docs/me.png', size: 1 },
					{ eventName: 'ObjectRemoved:Delete', key: 'avatars/old.png' },
				),
			),
		);

		expect(response.status).toBe(200);
		expect(handled).toEqual([
			{
				bucket: 'acme-uploads',
				key: 'avatars/me too.png',
				size: 7,
				etag: 'e1',
			},
		]);
	});

	it('answers the test event S3 sends on configuration, and runs nothing', async () => {
		const { subscriber, handled } = avatarSubscriber();

		const response = await adaptor(subscriber).handle(
			notification(
				JSON.stringify({ Service: 'Amazon S3', Event: 's3:TestEvent' }),
			),
		);

		expect(response.status).toBe(200);
		expect(handled).toEqual([]);
	});
});

describe('an object subscriber, run by Lambda', () => {
	it('reads S3 notifications delivered through SNS', async () => {
		const { subscriber, handled } = avatarSubscriber();
		const event: SNSEvent = {
			Records: [
				{
					EventSource: 'aws:sns',
					EventVersion: '1.0',
					EventSubscriptionArn: `${TOPIC_ARN}:sub`,
					Sns: {
						Message: s3Notification({
							eventName: 'ObjectCreated:Put',
							key: 'avatars/a.png',
							size: 3,
						}),
						MessageAttributes: {},
						TopicArn: TOPIC_ARN,
					} as unknown as SNSEvent['Records'][0]['Sns'],
				},
			],
		};

		await new AWSLambdaSubscriber(
			new EnvironmentParser({}),
			subscriber,
		).handler(event, lambdaContext);

		expect(handled.map((o) => o.key)).toEqual(['avatars/a.png']);
	});

	it('reads S3 notifications delivered straight to a queue', async () => {
		const { subscriber, handled } = avatarSubscriber();
		const event = {
			Records: [
				{
					eventSource: 'aws:sqs',
					messageId: 'm-1',
					body: s3Notification({
						eventName: 'ObjectCreated:Post',
						key: 'avatars/b.png',
						size: 4,
					}),
				},
			],
		} as unknown as SQSEvent;

		await new AWSLambdaSubscriber(
			new EnvironmentParser({}),
			subscriber,
		).handler(event, lambdaContext);

		expect(handled.map((o) => o.key)).toEqual(['avatars/b.png']);
	});
});

describe('an object subscriber, invoked in a test', () => {
	it('runs on object messages, as a relayed broker delivers them', async () => {
		const { subscriber, handled } = avatarSubscriber();

		await new TestSubscriberAdaptor(subscriber).invoke({
			events: [
				{
					type: 'object.created',
					payload: { bucket: 'acme-uploads', key: 'avatars/c.png' },
				},
				{
					type: 'object.created',
					payload: { bucket: 'acme-uploads', key: 'elsewhere/c.png' },
				},
			],
		});

		expect(handled.map((o) => o.key)).toEqual(['avatars/c.png']);
	});
});
