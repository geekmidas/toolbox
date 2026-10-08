import { context, trace } from '@opentelemetry/api';
import { afterAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../testkit/test/ports';
import { BasicConnection } from '../basic/BasicConnection';
import { basicEventsDriver } from '../basic/driver';
import { Publisher } from '../Publisher';
import { dropSchemas } from '../pgboss/__tests__/setup';
import { pgbossEventsDriver } from '../pgboss/driver';
import type { PgBossConnection } from '../pgboss/PgBossConnection';
import { registerEventsDriver } from '../registry';
import { Subscriber } from '../Subscriber';
import type { PublishableMessage } from '../types';

/**
 * No tracer provider, no propagator: a process that never asked for telemetry
 * publishes exactly what it did before, and consumes without errors.
 */

type Message = PublishableMessage<'order.placed', { id: string }>;
const PG = `geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const schema = `pgboss_noop_${Date.now()}`;

afterAll(() => dropSchemas(`postgres://${PG}`, [schema]));

describe('without a provider', () => {
	it('basic:// emits the message and no context', async () => {
		registerEventsDriver(basicEventsDriver);
		const connection = new BasicConnection();
		await connection.connect();
		const emitted: unknown[][] = [];
		connection.eventEmitter.on('order.placed', (...args) => emitted.push(args));

		const handled: Message[] = [];
		await Subscriber.fromConnection<Message>(connection).then((s) =>
			s.subscribe(['order.placed'], async (m) => {
				handled.push(m);
				expect(trace.getSpan(context.active())?.isRecording() ?? false).toBe(
					false,
				);
			}),
		);
		const publisher = await Publisher.fromConnection<Message>(connection);
		await publisher.publish([{ type: 'order.placed', payload: { id: '1' } }]);

		expect(emitted).toEqual([
			[{ type: 'order.placed', payload: { id: '1' } }, undefined],
		]);
		expect(handled).toEqual([{ type: 'order.placed', payload: { id: '1' } }]);
	});

	it('pgboss:// stores the payload as published, with no reserved key', async () => {
		registerEventsDriver(pgbossEventsDriver);
		const connection = (await pgbossEventsDriver.connect(
			`pgboss://${PG}?schema=${schema}`,
		)) as PgBossConnection;
		try {
			const publisher = await Publisher.fromConnection<Message>(connection);
			await publisher.publish([{ type: 'order.placed', payload: { id: '2' } }]);

			const [job] = await connection.instance!.fetch('order.placed');
			expect(job?.data).toEqual({ id: '2' });
		} finally {
			await connection.close();
		}
	});
});
