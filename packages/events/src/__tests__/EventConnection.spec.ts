import { describe, expect, it } from 'vitest';
import { EventConnectionFactory, EventPublisherType } from '../EventConnection';
import { UnsupportedEventTransport } from '../types';
import { registerAllEventsDrivers } from './__helpers__/drivers';

registerAllEventsDrivers();

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
			).rejects.toMatchObject({
				name: 'UnsupportedEventTransport',
				transport: 'unknown',
				role: 'connection',
			});
			await expect(
				EventConnectionFactory.fromConnectionString('unknown://localhost'),
			).rejects.toThrow(UnsupportedEventTransport);
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
