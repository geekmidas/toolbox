import { EnvironmentParser } from '@geekmidas/envkit';
import type { EventPublisher, PublishableMessage } from '@geekmidas/events';
import {
	PgBossConnection,
	PgBossPublisher,
	PgBossSubscriber,
} from '@geekmidas/events/pgboss';
import type { Service } from '@geekmidas/services';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { e } from '../EndpointFactory';
import { HonoEndpoint } from '../HonoEndpointAdaptor';

type OrderEvent =
	| PublishableMessage<'order.created', { orderId: string; total: number }>
	| PublishableMessage<'notification.sent', { orderId: string; type: string }>;

const POSTGRES_URL = 'postgres://geekmidas:geekmidas@localhost:5432/geekmidas';

const uniqueQueue = () =>
	`test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

describe('HonoEndpoint with PgBoss Publisher', () => {
	let connection: PgBossConnection;
	let envParser: EnvironmentParser<{}>;

	beforeAll(async () => {
		connection = new PgBossConnection({
			connectionString: POSTGRES_URL,
			schema: 'pgboss_hono_publisher_test',
		});
		await connection.connect();
		envParser = new EnvironmentParser({});
	});

	afterAll(async () => {
		await connection.close();
	});

	it('should publish events to pg-boss after successful endpoint execution', async () => {
		const eventType = uniqueQueue();
		const received: any[] = [];

		const publisher = new PgBossPublisher<OrderEvent>(connection);

		const PgBossPublisherService: Service<
			'eventPublisher',
			EventPublisher<OrderEvent>
		> = {
			serviceName: 'eventPublisher' as const,
			register: () => publisher,
		};

		const outputSchema = z.object({
			orderId: z.string(),
			total: z.number(),
		});

		const endpoint = e
			.publisher(PgBossPublisherService)
			.post('/orders')
			.output(outputSchema)
			.event({
				type: eventType as any,
				payload: (response) => ({
					orderId: response.orderId,
					total: response.total,
				}),
			})
			.handle(async () => ({
				orderId: 'order-42',
				total: 99.99,
			}));

		const serviceDiscovery = ServiceDiscovery.getInstance(envParser);
		const app = new Hono();
		HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);

		const adaptor = new HonoEndpoint(endpoint);
		adaptor.addRoute(serviceDiscovery, app);

		// Subscribe to events via pg-boss before making the request
		const subscriber = new PgBossSubscriber<OrderEvent>(connection, {
			pollingIntervalSeconds: 1,
		});
		await subscriber.subscribe([eventType as any], async (event) => {
			received.push(event);
		});

		// Fire the endpoint
		const response = await app.request('/orders', {
			method: 'POST',
			body: JSON.stringify({}),
			headers: { 'Content-Type': 'application/json' },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			orderId: 'order-42',
			total: 99.99,
		});

		// Wait for pg-boss to poll and deliver the event
		await new Promise((resolve) => setTimeout(resolve, 3000));

		expect(received.length).toBe(1);
		expect(received[0]).toEqual({
			type: eventType,
			payload: { orderId: 'order-42', total: 99.99 },
		});
	});

	it('should publish multiple events and respect when conditions', async () => {
		const createdType = uniqueQueue();
		const notificationType = uniqueQueue();
		const received: any[] = [];

		const publisher = new PgBossPublisher<OrderEvent>(connection);

		const PgBossPublisherService: Service<
			'eventPublisher',
			EventPublisher<OrderEvent>
		> = {
			serviceName: 'eventPublisher' as const,
			register: () => publisher,
		};

		const outputSchema = z.object({
			orderId: z.string(),
			total: z.number(),
			isHighValue: z.boolean(),
		});

		const endpoint = e
			.publisher(PgBossPublisherService)
			.post('/orders')
			.output(outputSchema)
			.event({
				type: createdType as any,
				payload: (response) => ({
					orderId: response.orderId,
					total: response.total,
				}),
			})
			.event({
				type: notificationType as any,
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

		const serviceDiscovery = ServiceDiscovery.getInstance(envParser);
		const app = new Hono();
		HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);

		const adaptor = new HonoEndpoint(endpoint);
		adaptor.addRoute(serviceDiscovery, app);

		// Subscribe to both event types
		const subscriber = new PgBossSubscriber<OrderEvent>(connection, {
			pollingIntervalSeconds: 1,
		});
		await subscriber.subscribe(
			[createdType as any, notificationType as any],
			async (event) => {
				received.push(event);
			},
		);

		// Fire the endpoint
		const response = await app.request('/orders', {
			method: 'POST',
			body: JSON.stringify({}),
			headers: { 'Content-Type': 'application/json' },
		});

		expect(response.status).toBe(200);

		// Wait for pg-boss to poll and deliver events
		await new Promise((resolve) => setTimeout(resolve, 3000));

		expect(received.length).toBe(2);
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
		const received: any[] = [];

		const publisher = new PgBossPublisher<OrderEvent>(connection);

		const PgBossPublisherService: Service<
			'eventPublisher',
			EventPublisher<OrderEvent>
		> = {
			serviceName: 'eventPublisher' as const,
			register: () => publisher,
		};

		const outputSchema = z.object({
			orderId: z.string(),
			total: z.number(),
			isHighValue: z.boolean(),
		});

		const endpoint = e
			.publisher(PgBossPublisherService)
			.post('/orders')
			.output(outputSchema)
			.event({
				type: eventType as any,
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

		const serviceDiscovery = ServiceDiscovery.getInstance(envParser);
		const app = new Hono();
		HonoEndpoint.applyEventMiddleware(app, serviceDiscovery);

		const adaptor = new HonoEndpoint(endpoint);
		adaptor.addRoute(serviceDiscovery, app);

		// Subscribe
		const subscriber = new PgBossSubscriber<OrderEvent>(connection, {
			pollingIntervalSeconds: 1,
		});
		await subscriber.subscribe([eventType as any], async (event) => {
			received.push(event);
		});

		// Fire the endpoint
		const response = await app.request('/orders', {
			method: 'POST',
			body: JSON.stringify({}),
			headers: { 'Content-Type': 'application/json' },
		});

		expect(response.status).toBe(200);

		// Wait to confirm no events arrive
		await new Promise((resolve) => setTimeout(resolve, 3000));

		expect(received.length).toBe(0);
	});
});
