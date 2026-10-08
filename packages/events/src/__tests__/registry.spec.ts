import { beforeEach, describe, expect, it } from 'vitest';
import { BasicConnection } from '../basic/BasicConnection';
import { BasicPublisher } from '../basic/BasicPublisher';
import { BasicSubscriber } from '../basic/BasicSubscriber';
import { basicEventsDriver } from '../basic/driver';
import { EventConnectionFactory } from '../EventConnection';
import { Publisher } from '../Publisher';
import {
	eventsDriverFor,
	registerEventsDriver,
	registeredEventsSchemes,
	UnregisteredEventsScheme,
} from '../registry';
import { Subscriber } from '../Subscriber';
import { sqsEventsDriver } from '../sqs/driver';
import { UnsupportedEventTransport } from '../types';
import { clearEventsDrivers } from './__helpers__/drivers';

beforeEach(() => clearEventsDrivers());

describe('the events driver registry', () => {
	it('has nothing registered until an entry point registers it', async () => {
		expect(registeredEventsSchemes()).toEqual([]);

		const error = await Publisher.fromConnectionString(
			'pgboss://u:p@localhost:5432/db',
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(UnregisteredEventsScheme);
		expect(error).toMatchObject({
			name: 'UnregisteredEventsScheme',
			scheme: 'pgboss',
			subpath: '@geekmidas/events/pgboss',
			driver: 'pgbossEventsDriver',
			registered: [],
		});
		// The message is the fix: the subpath and the call to make.
		expect((error as Error).message).toContain(
			"import { pgbossEventsDriver } from '@geekmidas/events/pgboss'",
		);
		expect((error as Error).message).toContain(
			'registerEventsDriver(pgbossEventsDriver)',
		);
	});

	it('names what is registered when the scheme is not', async () => {
		registerEventsDriver(basicEventsDriver);

		await expect(
			Subscriber.fromConnectionString('sns://?topicArn=arn'),
		).rejects.toMatchObject({
			name: 'UnregisteredEventsScheme',
			scheme: 'sns',
			subpath: '@geekmidas/events/sns',
			registered: ['basic'],
		});
		await expect(
			EventConnectionFactory.fromConnectionString('rabbitmq://localhost'),
		).rejects.toMatchObject({
			scheme: 'rabbitmq',
			driver: 'rabbitmqEventsDriver',
		});
	});

	it('still calls a scheme no broker here implements unsupported', async () => {
		// Listed as a type, never built: nothing to register.
		await expect(
			Publisher.fromConnectionString('kafka://localhost' as never),
		).rejects.toBeInstanceOf(UnsupportedEventTransport);
		await expect(
			Publisher.fromConnectionString('nope://localhost' as never),
		).rejects.toMatchObject({
			name: 'UnsupportedEventTransport',
			transport: 'nope',
			role: 'publisher',
		});
		expect(() => eventsDriverFor('nope:')).toThrow(UnsupportedEventTransport);
	});

	it('finds a driver by scheme, with or without the colon, or by string', () => {
		registerEventsDriver(basicEventsDriver);

		expect(eventsDriverFor('basic')).toBe(basicEventsDriver);
		expect(eventsDriverFor('basic:')).toBe(basicEventsDriver);
		expect(eventsDriverFor('basic://anything')).toBe(basicEventsDriver);
	});

	it('registers idempotently, and lists schemes sorted', () => {
		registerEventsDriver(sqsEventsDriver);
		registerEventsDriver(basicEventsDriver);
		registerEventsDriver(basicEventsDriver);

		expect(registeredEventsSchemes()).toEqual(['basic', 'sqs']);
	});

	it('builds connections, publishers and subscribers through the driver', async () => {
		registerEventsDriver(basicEventsDriver);

		const connection =
			await EventConnectionFactory.fromConnectionString('basic://');
		expect(connection).toBeInstanceOf(BasicConnection);
		expect(await Publisher.fromConnection(connection)).toBeInstanceOf(
			BasicPublisher,
		);
		expect(await Subscriber.fromConnection(connection)).toBeInstanceOf(
			BasicSubscriber,
		);
		expect(await Publisher.fromConnectionString('basic://')).toBeInstanceOf(
			BasicPublisher,
		);
		expect(await Subscriber.fromConnectionString('basic://')).toBeInstanceOf(
			BasicSubscriber,
		);
	});

	it('reaches the SNS driver for an sqs:// subscription to a topic, through the registry', async () => {
		registerEventsDriver(sqsEventsDriver);

		await expect(
			Subscriber.fromConnectionString(
				'sqs://?topicArn=arn:aws:sns:us-east-1:000000000000:orders&region=us-east-1',
			),
		).rejects.toMatchObject({
			name: 'UnregisteredEventsScheme',
			scheme: 'sns',
		});
	});
});
