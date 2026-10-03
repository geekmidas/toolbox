import { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher } from '@geekmidas/events';
import { PgBossConnection, PgBossSubscriber } from '@geekmidas/events/pgboss';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import type { Endpoint } from '../Endpoint';
import { HonoEndpoint } from '../HonoEndpointAdaptor';

/** Any endpoint, whatever it was built with — what an adaptor serves. */
type AnyEndpoint = Endpoint<
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>;

/** Endpoints are built from a surface now, so this builds one. */
const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });

// The port the stack was actually published on, not the one it defaults to.
// This suite hardcoded 5432 and so connected to whichever project happened to
// own it — passing or failing for reasons that had nothing to do with pgboss.
const POSTGRES_URL = `postgres://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas`;
const TEST_SCHEMA = 'pgboss_hono_publisher_test';

/**
 * What the deploy target hands the topic: its own publisher connection
 * string. The topic's service reads it and picks pg-boss from the protocol —
 * nothing in these tests stands in for the transport.
 */
const PUBLISHER_CONNECTION_STRING = `pgboss://geekmidas:geekmidas@localhost:${POSTGRES_PORT}/geekmidas?schema=${TEST_SCHEMA}`;

const uniqueQueue = () =>
	`test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

/**
 * A topic whose event types are unique to one test, so pg-boss queues from
 * one test never deliver into another.
 */
const ordersTopic = <const T extends string[]>(...types: T) =>
	new Topic('Orders', {
		events: Object.fromEntries(
			types.map((type) => [
				type,
				z.object({
					orderId: z.string(),
					total: z.number().optional(),
					type: z.string().optional(),
				}),
			]),
		) as Record<
			T[number],
			z.ZodObject<{
				orderId: z.ZodString;
				total: z.ZodOptional<z.ZodNumber>;
				type: z.ZodOptional<z.ZodString>;
			}>
		>,
	});

// Drop the test schema before pg-boss runs. Without this, a stale schema left
// behind by an older pg-boss version trips v12's migrator because it sees the
// `version` table but not the new `job_common` table.
async function dropTestSchema() {
	const client = new Client({ connectionString: POSTGRES_URL });
	await client.connect();
	try {
		await client.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
	} finally {
		await client.end();
	}
}

describe('HonoEndpoint with PgBoss Publisher', () => {
	let connection: PgBossConnection;
	let serviceDiscovery: ServiceDiscovery<any>;
	let topic: Topic<'Orders', any>;

	beforeAll(async () => {
		await dropTestSchema();
		connection = new PgBossConnection({
			connectionString: POSTGRES_URL,
			schema: TEST_SCHEMA,
		});
		await connection.connect();
	});

	afterEach(async () => {
		// The topic's publisher opened its own pg-boss connection; close it.
		const { orders } = (await serviceDiscovery.register([topic.service])) as {
			orders: EventPublisher<any> & { connection?: PgBossConnection };
		};
		await orders.connection?.close();
	});

	afterAll(async () => {
		await connection.close();
	});

	/** Serve `endpoint` with the topic's connection string configured. */
	const serve = (endpoint: AnyEndpoint) => {
		serviceDiscovery = new ServiceDiscovery(
			new EnvironmentParser({
				ORDERS_PUBLISHER_CONNECTION_STRING: PUBLISHER_CONNECTION_STRING,
			}),
		);
		const app = new Hono();
		HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);
		new HonoEndpoint(endpoint).addRoute(serviceDiscovery, app);
		return app;
	};

	// A subscriber to the topic, as the generated server subscribes one: by
	// name, so it drains a queue of its own that every message is copied to.
	const subscribe = async (types: string[], received: unknown[]) => {
		const subscriber = new PgBossSubscriber<any>(connection, {
			pollingIntervalSeconds: 1,
			topic: 'Orders',
			subscription: `test-${crypto.randomUUID()}`,
		});
		await subscriber.subscribe(types, async (event) => {
			received.push(event);
		});
	};

	const post = (app: Hono) =>
		app.request('/orders', {
			method: 'POST',
			body: JSON.stringify({}),
			headers: { 'Content-Type': 'application/json' },
		});

	it('should publish events to pg-boss after successful endpoint execution', async () => {
		const eventType = uniqueQueue();
		const received: unknown[] = [];
		topic = ordersTopic(eventType);

		const endpoint = api
			.post('/orders')
			.output(z.object({ orderId: z.string(), total: z.number() }))
			.event(topic, {
				type: eventType,
				payload: (response) => ({
					orderId: response.orderId,
					total: response.total,
				}),
			})
			.handle(async () => ({ orderId: 'order-42', total: 99.99 }));

		const app = serve(endpoint);
		// Subscribe to events via pg-boss before making the request
		await subscribe([eventType], received);

		const response = await post(app);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			orderId: 'order-42',
			total: 99.99,
		});

		// Wait for pg-boss to poll and deliver the event
		await new Promise((resolve) => setTimeout(resolve, 3000));

		expect(received).toEqual([
			{
				type: eventType,
				payload: { orderId: 'order-42', total: 99.99 },
			},
		]);
	});

	it('should publish multiple events and respect when conditions', async () => {
		const createdType = uniqueQueue();
		const notificationType = uniqueQueue();
		const received: unknown[] = [];
		topic = ordersTopic(createdType, notificationType);

		const endpoint = api
			.post('/orders')
			.output(
				z.object({
					orderId: z.string(),
					total: z.number(),
					isHighValue: z.boolean(),
				}),
			)
			.event(topic, {
				type: createdType,
				payload: (response) => ({
					orderId: response.orderId,
					total: response.total,
				}),
			})
			.event(topic, {
				type: notificationType,
				payload: (response) => ({
					orderId: response.orderId,
					type: 'high-value-alert',
				}),
				when: (response) => response.isHighValue === true,
			})
			.handle(async () => ({
				orderId: 'order-99',
				total: 5000,
				isHighValue: true,
			}));

		const app = serve(endpoint);
		await subscribe([createdType, notificationType], received);

		const response = await post(app);

		expect(response.status).toBe(200);

		// Wait for pg-boss to poll and deliver events
		await new Promise((resolve) => setTimeout(resolve, 3000));

		expect(received).toHaveLength(2);
		expect(received).toEqual(
			expect.arrayContaining([
				{
					type: createdType,
					payload: { orderId: 'order-99', total: 5000 },
				},
				{
					type: notificationType,
					payload: { orderId: 'order-99', type: 'high-value-alert' },
				},
			]),
		);
	});

	it('should not publish events when when condition is false', async () => {
		const eventType = uniqueQueue();
		const received: unknown[] = [];
		topic = ordersTopic(eventType);

		const endpoint = api
			.post('/orders')
			.output(
				z.object({
					orderId: z.string(),
					total: z.number(),
					isHighValue: z.boolean(),
				}),
			)
			.event(topic, {
				type: eventType,
				payload: (response) => ({
					orderId: response.orderId,
					type: 'high-value-alert',
				}),
				when: (response) => response.isHighValue === true,
			})
			.handle(async () => ({
				orderId: 'order-small',
				total: 5,
				isHighValue: false,
			}));

		const app = serve(endpoint);
		await subscribe([eventType], received);

		const response = await post(app);

		expect(response.status).toBe(200);

		// Wait to confirm no events arrive
		await new Promise((resolve) => setTimeout(resolve, 3000));

		expect(received).toEqual([]);
	});
});
