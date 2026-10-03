import type { Logger } from '@geekmidas/logger';
import { ServiceDiscovery } from '@geekmidas/services';
import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { createMockLogger } from '@geekmidas/testkit/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { recordTopic } from '../../__tests__/__helpers__/recordingPublisher';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';

const orders = new Topic('Orders', {
	events: {
		'order.created': z.object({ orderId: z.string(), email: z.string() }),
		'order.updated': z.object({
			orderId: z.string(),
			changes: z.array(z.string()),
		}),
	},
});

const v2Event = (
	method: string,
	path: string,
	overrides: Parameters<typeof createMockV2Event>[0] = {},
) =>
	createMockV2Event({
		requestContext: {
			...createMockV2Event().requestContext,
			http: {
				method,
				path,
				protocol: 'HTTP/1.1',
				sourceIp: '127.0.0.1',
				userAgent: 'test-agent',
			},
		},
		...overrides,
	});

/**
 * Several endpoints publishing to one topic. What used to be a publisher set
 * once on a factory is now the topic each endpoint names — so sharing one is
 * naming the same topic, and the publisher behind it is still one instance.
 */
describe('AmazonApiGatewayV2Endpoint endpoints sharing a topic', () => {
	let mockLogger: Logger;
	let api: RestApi<'Test'>;

	beforeEach(() => {
		mockLogger = createMockLogger();
		api = new RestApi('Test', {
			path: '.',
			defaultAuthorizer: 'none',
			logger: mockLogger,
		});
		ServiceDiscovery.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should publish through the topic's own service", async () => {
		const publisher = recordTopic(orders);

		const endpoint = api
			.post('/orders')
			.body(z.object({ productId: z.string(), quantity: z.number() }))
			.output(z.object({ orderId: z.string(), amount: z.number() }))
			.event(orders, {
				type: 'order.created',
				payload: (response) => ({
					orderId: response.orderId,
					email: `order-${response.orderId}@example.com`,
				}),
			})
			.handle(async () => ({ orderId: 'order-123', amount: 99.99 }));

		const response = await new AmazonApiGatewayV2Endpoint(endpoint).handler(
			v2Event('POST', '/orders', {
				body: JSON.stringify({ productId: 'prod-456', quantity: 2 }),
			}),
			createMockContext(),
		);

		expect(response.statusCode).toBe(200);
		expect(response.body).toBe(
			JSON.stringify({ orderId: 'order-123', amount: 99.99 }),
		);
		expect(orders.service.register).toHaveBeenCalled();
		expect(publisher.published).toEqual([
			{
				type: 'order.created',
				payload: {
					orderId: 'order-123',
					email: 'order-order-123@example.com',
				},
			},
		]);
	});

	it('should honour conditional events', async () => {
		const publisher = recordTopic(orders);

		const endpoint = api
			.post('/orders')
			.body(z.object({ isNew: z.boolean() }))
			.output(z.object({ orderId: z.string(), isNew: z.boolean() }))
			.event(orders, {
				type: 'order.created',
				payload: (response) => ({
					orderId: response.orderId,
					email: 'new@example.com',
				}),
				when: (response) => response.isNew,
			})
			.event(orders, {
				type: 'order.updated',
				payload: (response) => ({
					orderId: response.orderId,
					changes: ['status'],
				}),
				when: (response) => !response.isNew,
			})
			.handle(async ({ body }) => ({ orderId: 'o-1', isNew: body.isNew }));

		const handler = new AmazonApiGatewayV2Endpoint(endpoint).handler;

		await handler(
			v2Event('POST', '/orders', { body: JSON.stringify({ isNew: true }) }),
			createMockContext(),
		);
		await handler(
			v2Event('POST', '/orders', { body: JSON.stringify({ isNew: false }) }),
			createMockContext(),
		);

		expect(publisher.calls).toEqual([
			[
				{
					type: 'order.created',
					payload: { orderId: 'o-1', email: 'new@example.com' },
				},
			],
			[
				{
					type: 'order.updated',
					payload: { orderId: 'o-1', changes: ['status'] },
				},
			],
		]);
	});

	it('should share one publisher between endpoints naming the same topic', async () => {
		const publisher = recordTopic(orders);

		const createEndpoint = api
			.post('/orders')
			.output(z.object({ orderId: z.string() }))
			.event(orders, {
				type: 'order.created',
				payload: (response) => ({
					orderId: response.orderId,
					email: 'create@example.com',
				}),
			})
			.handle(async () => ({ orderId: 'create-order' }));

		const updateEndpoint = api
			.put('/orders/:id')
			.params(z.object({ id: z.string() }))
			.output(z.object({ orderId: z.string() }))
			.event(orders, {
				type: 'order.updated',
				payload: (response) => ({
					orderId: response.orderId,
					changes: ['status'],
				}),
			})
			.handle(async ({ params }) => ({ orderId: params.id }));

		// Both name the topic, so both carry its one service.
		expect(createEndpoint.services).toEqual([orders.service]);
		expect(updateEndpoint.services).toEqual([orders.service]);

		await new AmazonApiGatewayV2Endpoint(createEndpoint).handler(
			v2Event('POST', '/orders'),
			createMockContext(),
		);
		await new AmazonApiGatewayV2Endpoint(updateEndpoint).handler(
			v2Event('PUT', '/orders/update-order', {
				pathParameters: { id: 'update-order' },
			}),
			createMockContext(),
		);

		// Registered once, reused for the second endpoint.
		expect(orders.service.register).toHaveBeenCalledTimes(1);
		expect(publisher.calls).toEqual([
			[
				{
					type: 'order.created',
					payload: { orderId: 'create-order', email: 'create@example.com' },
				},
			],
			[
				{
					type: 'order.updated',
					payload: { orderId: 'update-order', changes: ['status'] },
				},
			],
		]);
	});
});
