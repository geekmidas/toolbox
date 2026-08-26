import { describe, expect, it } from 'vitest';
import { snsUrl } from '../sns';
import { sqsUrl } from '../sqs';

const QUEUE = 'https://sqs.us-east-1.amazonaws.com/123456789012/emails';
const TOPIC = 'arn:aws:sns:us-east-1:123456789012:users';

describe('sqsUrl', () => {
	it('round-trips', () => {
		// The property the whole shape exists for: a deploy target composes
		// these and the publisher reads them back, so composing something
		// unreadable has to be impossible rather than merely unlikely.
		const address = {
			queueUrl: QUEUE,
			region: 'us-east-1',
			endpoint: 'http://localhost:4566',
			maxBatchSize: 10,
		};

		expect(sqsUrl.parse(sqsUrl.build(address))).toEqual(address);
	});

	it('omits what was not given', () => {
		expect(sqsUrl.parse(sqsUrl.build({ queueUrl: QUEUE }))).toEqual({
			queueUrl: QUEUE,
		});
	});

	it('refuses a string that names no queue', () => {
		expect(() => sqsUrl.parse('sqs://?region=us-east-1')).toThrow(
			sqsUrl.MissingQueueUrl,
		);
	});

	it('refuses another scheme', () => {
		expect(() => sqsUrl.parse(snsUrl.build({ topicArn: TOPIC }))).toThrow(
			sqsUrl.UnexpectedQueueScheme,
		);
	});
});

describe('snsUrl', () => {
	it('round-trips', () => {
		const address = {
			topicArn: TOPIC,
			region: 'us-east-1',
			endpoint: 'http://localhost:4566',
			queueName: 'users-worker',
		};

		expect(snsUrl.parse(snsUrl.build(address))).toEqual(address);
	});

	it('carries no queue on a publisher’s string', () => {
		// Fan-out delivers to a queue per subscriber, so the publisher's string
		// names the topic and nothing else.
		expect(snsUrl.parse(snsUrl.build({ topicArn: TOPIC }))).toEqual({
			topicArn: TOPIC,
		});
	});

	it('refuses a string that names no topic', () => {
		expect(() => snsUrl.parse('sns://?region=us-east-1')).toThrow(
			snsUrl.MissingTopicArn,
		);
	});
});
