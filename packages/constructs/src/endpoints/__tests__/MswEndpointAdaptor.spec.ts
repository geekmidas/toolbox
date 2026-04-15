import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { e } from '../EndpointFactory';
import { createMswHandlers, TEST_CONTEXT_HEADER } from '../MswEndpointAdaptor';

const BASE_URL = 'http://localhost:3000';

// --- Services ---

interface UserDatabase {
	listUsers(): { id: string; name: string }[];
}

const DatabaseService = {
	serviceName: 'database' as const,
	register: () => ({ listUsers: () => [] }) as UserDatabase,
};

// --- Endpoints ---

const listUsers = e
	.get('/users')
	.services([DatabaseService])
	.output(
		z.object({
			users: z.array(z.object({ id: z.string(), name: z.string() })),
		}),
	)
	.handle(async ({ services }) => {
		const users = services.database.listUsers();
		return { users };
	});

const createUser = e
	.post('/users')
	.body(z.object({ name: z.string().min(1), email: z.string().email() }))
	.output(z.object({ id: z.string(), name: z.string(), email: z.string() }))
	.handle(async ({ body }) => ({
		id: crypto.randomUUID(),
		name: body.name,
		email: body.email,
	}));

const getUser = e
	.get('/users/:id')
	.params(z.object({ id: z.string() }))
	.output(z.object({ id: z.string(), name: z.string() }))
	.handle(async ({ params }) => ({
		id: params.id,
		name: 'Test User',
	}));

const authorizedEndpoint = e
	.get('/protected')
	.output(z.object({ message: z.string() }))
	.authorize(({ header }) => header('authorization') === 'Bearer valid-token')
	.handle(async () => ({ message: 'secret' }));

// --- Setup ---

const { handlers, registerContext } = createMswHandlers(
	[listUsers, createUser, getUser, authorizedEndpoint],
	{ baseURL: BASE_URL },
);

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// --- Tests ---

describe('MswEndpointAdaptor', () => {
	it('should handle a simple GET request', async () => {
		const contextId = crypto.randomUUID();
		registerContext(contextId, {
			services: {
				database: { listUsers: () => [{ id: '1', name: 'Alice' }] },
			},
		});

		const response = await fetch(`${BASE_URL}/users`, {
			headers: { [TEST_CONTEXT_HEADER]: contextId },
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.users).toEqual([{ id: '1', name: 'Alice' }]);
	});

	it('should handle POST with body validation', async () => {
		const contextId = crypto.randomUUID();
		registerContext(contextId, {});

		const response = await fetch(`${BASE_URL}/users`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				[TEST_CONTEXT_HEADER]: contextId,
			},
			body: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }),
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.name).toBe('Bob');
		expect(body.email).toBe('bob@example.com');
		expect(body.id).toBeDefined();
	});

	it('should reject invalid body with 422', async () => {
		const contextId = crypto.randomUUID();
		registerContext(contextId, {});

		const response = await fetch(`${BASE_URL}/users`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				[TEST_CONTEXT_HEADER]: contextId,
			},
			body: JSON.stringify({ name: '', email: 'not-an-email' }),
		});

		expect(response.status).toBe(422);
	});

	it('should handle path params', async () => {
		const contextId = crypto.randomUUID();
		registerContext(contextId, {});

		const response = await fetch(`${BASE_URL}/users/user-123`, {
			headers: { [TEST_CONTEXT_HEADER]: contextId },
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.id).toBe('user-123');
		expect(body.name).toBe('Test User');
	});

	it('should return 401 when authorization fails', async () => {
		const contextId = crypto.randomUUID();
		registerContext(contextId, {});

		const response = await fetch(`${BASE_URL}/protected`, {
			headers: {
				[TEST_CONTEXT_HEADER]: contextId,
				authorization: 'Bearer wrong-token',
			},
		});

		expect(response.status).toBe(401);
	});

	it('should return 200 when authorization passes', async () => {
		const contextId = crypto.randomUUID();
		registerContext(contextId, {});

		const response = await fetch(`${BASE_URL}/protected`, {
			headers: {
				[TEST_CONTEXT_HEADER]: contextId,
				authorization: 'Bearer valid-token',
			},
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.message).toBe('secret');
	});

	it('should return 500 when context ID is missing', async () => {
		const response = await fetch(`${BASE_URL}/users`);

		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.error).toContain('Missing or unknown test context ID');
	});

	it('should isolate concurrent contexts', async () => {
		const contextA = crypto.randomUUID();
		const contextB = crypto.randomUUID();

		registerContext(contextA, {
			services: {
				database: { listUsers: () => [{ id: '1', name: 'From A' }] },
			},
		});
		registerContext(contextB, {
			services: {
				database: { listUsers: () => [{ id: '2', name: 'From B' }] },
			},
		});

		const [responseA, responseB] = await Promise.all([
			fetch(`${BASE_URL}/users`, {
				headers: { [TEST_CONTEXT_HEADER]: contextA },
			}),
			fetch(`${BASE_URL}/users`, {
				headers: { [TEST_CONTEXT_HEADER]: contextB },
			}),
		]);

		const bodyA = await responseA.json();
		const bodyB = await responseB.json();

		expect(bodyA.users).toEqual([{ id: '1', name: 'From A' }]);
		expect(bodyB.users).toEqual([{ id: '2', name: 'From B' }]);
	});
});
