import { snsUrl } from '@geekmidas/events/sns';
import { sqsUrl } from '@geekmidas/events/sqs';
import { describe, expect, it } from 'vitest';
import { fifoName, Queue } from '../aws/Queue';
import { Secret } from '../aws/Secret';
import { Topic } from '../aws/Topic';
import { regionOfArn } from '../naming';

/**
 * What each component resolves onto its consumers.
 *
 * Asserted by parsing the string back with the client's own codec, not by
 * matching text: the contract is that the publisher can read what the deploy
 * target wrote, and a string comparison would pass on a value nothing can
 * consume.
 */

const stack = {} as never;

describe('Queue', () => {
	it('provides a connection string its publisher can parse', () => {
		const provided = new Queue(stack, 'Emails').provides();

		expect(
			sqsUrl.parse(provided.publisherConnectionString as string),
		).toMatchObject({
			queueUrl: expect.stringContaining('/Emails'),
			region: 'stub-region',
		});
	});

	it('provides one key, the producer’s', () => {
		// A worker is reached *through* the queue, so there is no second address
		// and nothing can depend on the handler.
		expect(Object.keys(new Queue(stack, 'Emails').provides())).toEqual([
			'publisherConnectionString',
		]);
	});
});

describe('Topic', () => {
	it('provides a connection string its publisher can parse', () => {
		const provided = new Topic(stack, 'Users').provides();

		expect(
			snsUrl.parse(provided.publisherConnectionString as string),
		).toMatchObject({
			topicArn: expect.stringContaining(':Users'),
			region: 'stub-region',
		});
	});

	it('names no queue, so a subscriber cannot be reached by holding it', () => {
		const provided = new Topic(stack, 'Users').provides();

		expect(
			snsUrl.parse(provided.publisherConnectionString as string).queueName,
		).toBeUndefined();
	});
});

describe('Secret', () => {
	it('provides a value, because it has no address to hand out instead', () => {
		expect(new Secret(stack, 'AuthSecret').provides()).toEqual({
			value: 'stub-secret-AuthSecret',
		});
	});
});

describe('regionOfArn', () => {
	it('reads the region out of an ARN', () => {
		// Carried explicitly because AWS_REGION inside a Lambda is the
		// *function's* region: a queue elsewhere works until it doesn't.
		expect(regionOfArn('arn:aws:sqs:eu-west-1:123:emails')).toBe('eu-west-1');
	});

	it('is undefined where an ARN carries no region', () => {
		expect(regionOfArn('arn:aws:iam::123:role/x')).toBeUndefined();
		expect(regionOfArn('not-an-arn')).toBeUndefined();
	});
});

describe('fifoName', () => {
	it('appends .fifo to a FIFO queue’s name', () => {
		// AWS rejects the mistake at the API call rather than at plan time, so
		// the component fixes it where the fact lives.
		expect(fifoName('emails', true)).toBe('emails.fifo');
	});

	it('does not append it twice', () => {
		// `.fifo` counts toward the 80-character limit.
		expect(fifoName('emails.fifo', true)).toBe('emails.fifo');
	});

	it('treats the object form as FIFO', () => {
		expect(fifoName('emails', { contentBasedDeduplication: true })).toBe(
			'emails.fifo',
		);
	});

	it('strips it from a standard queue’s name', () => {
		// The rule runs both ways: a standard queue whose name ends in `.fifo`
		// is rejected just as loudly.
		expect(fifoName('emails.fifo', false)).toBe('emails');
		expect(fifoName('emails.fifo', undefined)).toBe('emails');
	});
});
