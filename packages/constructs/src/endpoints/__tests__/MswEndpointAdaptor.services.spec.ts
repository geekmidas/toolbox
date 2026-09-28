import type { AuditStorage } from '@geekmidas/audit';
import type { Service } from '@geekmidas/services';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import { createMswHandlers, TEST_CONTEXT_HEADER } from '../MswEndpointAdaptor';

/**
 * What a test context supplies in place of the endpoint's own services: the
 * database and the audit store the endpoint declared, and a publisher.
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

const listOrders = api.endpoints
	.database(database)
	.get('/orders')
	.output(z.object({ orders: z.array(z.string()) }))
	.handle(async ({ db }) => ({ orders: (db as Db).orders() }));

const audited = api.endpoints
	.auditor(auditStore)
	.get('/audited')
	.output(z.object({ ok: z.boolean() }))
	.handle(async ({ auditor }) => ({ ok: auditor !== undefined }));

const { handlers, registerContext } = createMswHandlers([listOrders, audited], {
	baseURL: BASE_URL,
});
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());

const call = (path: string, contextId: string) =>
	fetch(`${BASE_URL}${path}`, {
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

	it('registers the audit store and a publisher the test supplied', async () => {
		const id = crypto.randomUUID();
		let published = false;
		registerContext(id, {
			auditorStorage: {
				write: async () => {},
			} as unknown as AuditStorage,
			publisher: {
				serviceName: 'events',
				register: () => {
					published = true;
					return { publish: async () => {} };
				},
			} as Service,
		});

		const response = await call('/audited', id);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		// The publisher is registered with the test's own service discovery.
		expect(published).toBe(true);
	});
});
