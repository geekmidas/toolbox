import type { AuditStorage } from '@geekmidas/audit';
import type { Service } from '@geekmidas/services';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { recordingPublisher } from '../../__tests__/__helpers__/recordingPublisher';
import { RestApi } from '../../rest-api';
import { Topic } from '../../topic/Topic';
import { createMswHandlers, TEST_CONTEXT_HEADER } from '../MswEndpointAdaptor';

/**
 * What a test context supplies in place of the endpoint's own services: the
 * database and the audit store the endpoint declared, and a recorder standing
 * in for a topic it publishes to — under the topic's own service name.
 */

const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });
const BASE_URL = 'http://msw-services.test';

interface Db {
	orders: () => string[];
}

const database: Service<'ordersDb', Db> = {
	serviceName: 'ordersDb',
	register: () => ({ orders: () => ['from the real db'] }),
};
const auditStore: Service<'auditStore', AuditStorage> = {
	serviceName: 'auditStore',
	register: () => ({}) as AuditStorage,
};

const listOrders = api
	.database(database)
	.get('/orders')
	.output(z.object({ orders: z.array(z.string()) }))
	.handle(async ({ db }) => ({ orders: (db as Db).orders() }));

const audited = api
	.auditor(auditStore)
	.get('/audited')
	.output(z.object({ ok: z.boolean() }))
	.handle(async ({ auditor }) => ({ ok: auditor !== undefined }));

const orderEvents = new Topic('Orders', {
	events: { 'order.placed': z.object({ orderId: z.string() }) },
});

const placeOrder = api
	.post('/orders')
	.output(z.object({ orderId: z.string() }))
	.event(orderEvents, {
		type: 'order.placed',
		payload: (order) => ({ orderId: order.orderId }),
	})
	.handle(async () => ({ orderId: 'o-1' }));

const { handlers, registerContext } = createMswHandlers(
	[listOrders, audited, placeOrder],
	{ baseURL: BASE_URL },
);
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());

const call = (path: string, contextId: string, method = 'GET') =>
	fetch(`${BASE_URL}${path}`, {
		method,
		headers: { [TEST_CONTEXT_HEADER]: contextId },
	});

describe('createMswHandlers contexts', () => {
	it('hands the endpoint the database the test supplied', async () => {
		const id = crypto.randomUUID();
		registerContext(id, {
			database: { orders: () => ['from the test'] } satisfies Db,
		});

		const response = await call('/orders', id);

		expect(await response.json()).toEqual({ orders: ['from the test'] });
	});

	it('registers the audit store the test supplied', async () => {
		const id = crypto.randomUUID();
		registerContext(id, {
			auditorStorage: {
				write: async () => {},
			} as unknown as AuditStorage,
		});

		const response = await call('/audited', id);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("publishes to the recorder the test supplied under the topic's name", async () => {
		const id = crypto.randomUUID();
		const orders = recordingPublisher();
		registerContext(id, { services: { orders } });

		const response = await call('/orders', id, 'POST');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ orderId: 'o-1' });
		// Registered with the test's own service discovery, so no connection
		// string is needed and no other context sees it.
		expect(orders.published).toEqual([
			{ type: 'order.placed', payload: { orderId: 'o-1' } },
		]);
	});
});
