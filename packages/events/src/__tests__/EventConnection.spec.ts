import { describe, expect, it } from 'vitest';
import { EventConnectionFactory, EventPublisherType } from '../EventConnection';

describe('EventConnectionFactory', () => {
	describe('fromConnectionString', () => {
		it('should create BasicConnection for basic:// protocol', async () => {
			const connection =
				await EventConnectionFactory.fromConnectionString('basic://memory');
			expect(connection).toBeDefined();
		});

		it('should throw for unsupported protocol', async () => {
			await expect(
				EventConnectionFactory.fromConnectionString('unknown://localhost'),
			).rejects.toThrow('Unsupported connection type: unknown');
		});

		it('should throw for invalid URL', async () => {
			await expect(
				EventConnectionFactory.fromConnectionString('not-a-url'),
			).rejects.toThrow();
		});
	});
});

describe('EventPublisherType', () => {
	it('should have Basic type', () => {
		expect(EventPublisherType.Basic).toBe('basic');
	});

	it('should have RabbitMQ type', () => {
		expect(EventPublisherType.RabbitMQ).toBe('rabbitmq');
	});

	it('should have SQS type', () => {
		expect(EventPublisherType.SQS).toBe('sqs');
	});

	it('should have SNS type', () => {
		expect(EventPublisherType.SNS).toBe('sns');
	});
});
