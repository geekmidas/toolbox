import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import type { Context, SQSEvent } from 'aws-lambda';
import { type Kysely, sql } from 'kysely';
import {
	afterAll,
	afterEach,
	describe,
	expect,
	expectTypeOf,
	it,
} from 'vitest';
import { z } from 'zod';
import { POSTGRES_PORT } from '../../../testkit/test/ports';
import { KyselyDatabase } from '../database/kysely';
import { AWSLambdaQueue } from '../queue/AWSLambdaQueueAdaptor';
import { TestQueueAdaptor } from '../queue/TestQueueAdaptor';
import { AWSLambdaSubscriber } from '../subscribers/AWSLambdaSubscriberAdaptor';
import { TestSubscriberAdaptor } from '../subscribers/TestSubscriberAdaptor';
import { Topic } from '../topic/Topic';
import { Worker } from '../worker';

interface OrdersDB {
	orders: { id: string };
}
interface AnalyticsDB {
	events: { id: string };
}

const orders = new KyselyDatabase<OrdersDB, 'Orders'>('Orders');
const analytics = new KyselyDatabase<AnalyticsDB, 'Analytics'>('Analytics');

// Two real databases on the test Postgres, so a handler reporting which one it
// is connected to proves which construct its `db` was registered from.
const url = (database: string) =>
	`postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/${database}`;
const env = {
	ORDERS_URL: url('geekmidas'),
	// Exists on every Postgres, so nothing has to create it first.
	ANALYTICS_URL: url('postgres'),
};

const users = new Topic('Users', {
	events: { 'user.created': z.object({ id: z.string() }) },
});
const message = z.object({ id: z.string() });

const context = {
	functionName: 'jobs',
	awsRequestId: 'req-1',
} as Context;

const sqs = (body: unknown): SQSEvent => ({
	Records: [
		{
			messageId: 'm1',
			eventSource: 'aws:sqs',
			body: JSON.stringify(body),
		} as SQSEvent['Records'][number],
	],
});

/** Which database a client is connected to, asked of the database itself. */
const databaseOf = async (db: Kysely<any>) => {
	const { rows } = await sql<{
		name: string;
	}>`select current_database() as name`.execute(db);

	return rows[0]?.name;
};

const opened = new Set<Kysely<any>>();
const discovery = () => {
	ServiceDiscovery.reset();
	return ServiceDiscovery.getInstance(new EnvironmentParser(env));
};

afterEach(() => {
	ServiceDiscovery.reset();
});

afterAll(async () => {
	for (const db of opened) await db.destroy();
});

describe('worker.database(db)', () => {
	const worker = new Worker('Jobs').database(orders);

	describe('as the default for everything built from the worker', () => {
		it('hands a cron the database, typed from the construct', () => {
			const cron = worker.cron('rate(1 day)').handle(async ({ db }) => {
				expectTypeOf(db).toEqualTypeOf<Kysely<OrdersDB>>();
			});

			expect(cron.databaseService).toBe(orders.service);
			expect(cron.constructs).toEqual(['Orders']);
			// Still where its schedule is kept.
			expect(cron.scheduleStore).toBe(orders.service);
		});

		it('hands a queue the database', () => {
			const queue = worker
				.queue('Emails')
				.message(message)
				.handle(async ({ db }) => {
					expectTypeOf(db).toEqualTypeOf<Kysely<OrdersDB>>();
				});

			expect(queue.databaseService).toBe(orders.service);
			expect(queue.constructs).toEqual(['Orders']);
		});

		it('hands a subscriber the database', () => {
			const subscriber = worker
				.topic(users)
				.subscribe(['user.created'])
				.handle(async ({ db }) => {
					expectTypeOf(db).toEqualTypeOf<Kysely<OrdersDB>>();
				});

			expect(subscriber.databaseService).toBe(orders.service);
			expect(subscriber.constructs).toEqual(['Orders']);
		});

		it('hands a function the database', () => {
			const fn = worker.handle(async ({ db }) => {
				expectTypeOf(db).toEqualTypeOf<Kysely<OrdersDB>>();
			});

			expect(fn.databaseService).toBe(orders.service);
			expect(fn.constructs).toEqual(['Orders']);
		});

		it('contributes the database’s env, as a dependency would', async () => {
			const queue = worker
				.queue('Emails')
				.message(message)
				.handle(async () => {});

			expect(await queue.getEnvironment()).toContain('ORDERS_URL');
		});

		it('gives nothing a db when the worker names no database', () => {
			const queue = new Worker('Jobs')
				.queue('Emails')
				.message(message)
				.handle(async (ctx) => {
					expectTypeOf(ctx).not.toHaveProperty('db');
				});

			expect(queue.databaseService).toBeUndefined();
			expect(queue.constructs).toEqual([]);
		});
	});

	describe('overridden by .database(other)', () => {
		it('retypes and replaces a cron’s db, edge and all', () => {
			const cron = worker
				.cron('rate(1 day)')
				.database(analytics)
				.handle(async ({ db }) => {
					expectTypeOf(db).toEqualTypeOf<Kysely<AnalyticsDB>>();
				});

			expect(cron.databaseService).toBe(analytics.service);
			// Replaced, not added to: a Lambda built from it is not granted the
			// worker's database it no longer uses.
			expect(cron.constructs).toEqual(['Analytics']);
			// The schedule is still the worker's to keep.
			expect(cron.scheduleStore).toBe(orders.service);
		});

		it('retypes and replaces a queue’s db', () => {
			const queue = worker
				.queue('Reports')
				.database(analytics)
				.message(message)
				.handle(async ({ db }) => {
					expectTypeOf(db).toEqualTypeOf<Kysely<AnalyticsDB>>();
				});

			expect(queue.databaseService).toBe(analytics.service);
			expect(queue.constructs).toEqual(['Analytics']);
		});

		it('retypes and replaces a subscriber’s db', () => {
			const subscriber = worker
				.topic(users)
				.database(analytics)
				.subscribe(['user.created'])
				.handle(async ({ db }) => {
					expectTypeOf(db).toEqualTypeOf<Kysely<AnalyticsDB>>();
				});

			expect(subscriber.databaseService).toBe(analytics.service);
			expect(subscriber.constructs).toEqual(['Analytics']);
		});

		it('keeps the worker’s database as an edge when it is still depended on', () => {
			const queue = worker
				.queue('Reports')
				.dependsOn([orders])
				.database(analytics)
				.message(message)
				.handle(async ({ db, services }) => {
					expectTypeOf(db).toEqualTypeOf<Kysely<AnalyticsDB>>();
					expectTypeOf(services.orders).toEqualTypeOf<Kysely<OrdersDB>>();
				});

			expect(queue.constructs).toEqual(['Orders', 'Analytics']);
		});

		it('gives a database to a runnable on a worker that has none', () => {
			const queue = new Worker('Jobs')
				.queue('Reports')
				.database(analytics)
				.message(message)
				.handle(async () => {});

			expect(queue.databaseService).toBe(analytics.service);
			expect(queue.constructs).toEqual(['Analytics']);
		});
	});
});

describe('a working db reaches the handler', () => {
	const worker = new Worker('Jobs').database(orders);

	it('in a queue run by the test adaptor', async () => {
		const queue = worker
			.queue('Emails')
			.message(message)
			.handle(async ({ db }) => {
				opened.add(db);
				return databaseOf(db);
			});

		const result = await new TestQueueAdaptor(queue, discovery()).invoke({
			messages: [{ id: '1' }],
		});

		expect(result).toBe('geekmidas');
	});

	it('in a queue run on Lambda, from its own database when overridden', async () => {
		const seen: (string | undefined)[] = [];
		const queue = worker
			.queue('Reports')
			.database(analytics)
			.message(message)
			.handle(async ({ db }) => {
				opened.add(db);
				seen.push(await databaseOf(db));
			});

		discovery();
		const lambda = new AWSLambdaQueue(new EnvironmentParser(env), queue);
		const result = await lambda.handler(
			sqs({ type: 'Reports', payload: { id: '1' } }),
			context,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(seen).toEqual(['postgres']);
	});

	it('in a subscriber run by the test adaptor', async () => {
		const subscriber = worker
			.topic(users)
			.subscribe(['user.created'])
			.handle(async ({ db }) => {
				opened.add(db);
				return databaseOf(db);
			});

		const result = await new TestSubscriberAdaptor(
			subscriber,
			discovery(),
		).invoke({ events: [{ type: 'user.created', payload: { id: '1' } }] });

		expect(result).toBe('geekmidas');
	});

	it('in a subscriber run on Lambda', async () => {
		const seen: (string | undefined)[] = [];
		const subscriber = worker
			.topic(users)
			.subscribe(['user.created'])
			.handle(async ({ db }) => {
				opened.add(db);
				seen.push(await databaseOf(db));
			});

		discovery();
		const lambda = new AWSLambdaSubscriber(
			new EnvironmentParser(env),
			subscriber,
		);
		await lambda.handler(
			sqs({ type: 'user.created', payload: { id: '1' } }),
			context,
			() => {},
		);

		expect(seen).toEqual(['geekmidas']);
	});

	it('uses the db a test passes in place of the queue’s own', async () => {
		const queue = worker
			.queue('Emails')
			.message(message)
			.handle(async ({ db }) => db);
		const stand = {} as Kysely<OrdersDB>;

		const result = await new TestQueueAdaptor(queue, discovery()).invoke({
			messages: [{ id: '1' }],
			db: stand,
		});

		expect(result).toBe(stand);
	});
});
