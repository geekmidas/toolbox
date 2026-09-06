import { describe, expect, it } from 'vitest';
import { getJson, patchJson, postJson } from './__helpers__/app.js';
import { signIn } from './__helpers__/signIn.js';

interface User {
	id: string;
	name: string;
	email: string;
	created_at: string;
}

const unique = (prefix: string) =>
	`${prefix}+${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`;

describe('users', () => {
	it('creates one and returns it', async () => {
		const email = unique('ada');
		const { status, body } = await postJson<User>('/users', {
			name: 'Ada',
			email,
		});

		expect(status).toBe(200);
		expect(body.email).toBe(email);
		expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('rejects a body that is not a user', async () => {
		// The endpoint's schema is the contract and it is checked before the
		// handler runs, so this never reaches the database. 422 rather than 400:
		// the request parsed fine and its *contents* are what failed, which is
		// the distinction Unprocessable Entity exists for.
		const { status } = await postJson('/users', { name: '', email: 'nope' });

		expect(status).toBe(422);
	});

	it('serves the list from the cache once it is warm', async () => {
		// The cache is a table in the app's own database, reached by the same
		// role. Two reads is the shape of the assertion: the second is served
		// from what the first stored, and both answer the same thing.
		const first = await getJson<{ users: User[] }>('/users');
		const second = await getJson<{ users: User[] }>('/users');

		expect(first.status).toBe(200);
		expect(second.body.users).toEqual(first.body.users);
	});

	it('invalidates that cache when a user is created', async () => {
		// The interesting half. A cache nothing invalidates is a cache that is
		// wrong for its TTL, and the endpoint deletes the key inside the same
		// request that inserted the row.
		await getJson<{ users: User[] }>('/users');

		const email = unique('grace');
		await postJson<User>('/users', { name: 'Grace', email });

		const { body } = await getJson<{ users: User[] }>('/users');

		expect(body.users.map((u) => u.email)).toContain(email);
	});

	it('refuses to read one without a session', async () => {
		const created = await postJson<User>('/users', {
			name: 'Ada',
			email: unique('ada'),
		});

		const { status } = await getJson(`/users/${created.body.id}`);

		expect(status).toBe(401);
	});

	it('reads one with a session', async () => {
		const email = unique('hopper');
		const created = await postJson<User>('/users', { name: 'Grace', email });
		const session = await signIn(email);

		const { status, body } = await getJson<User>(`/users/${created.body.id}`, {
			headers: { cookie: session.cookie },
		});

		expect(status).toBe(200);
		expect(body.email).toBe(email);
	});

	it('404s a user that is not there rather than 500ing', async () => {
		const email = unique('hopper');
		await postJson<User>('/users', { name: 'Grace', email });
		const session = await signIn(email);

		const { status } = await getJson(
			'/users/00000000-0000-0000-0000-000000000000',
			{ headers: { cookie: session.cookie } },
		);

		expect(status).toBe(404);
	});

	it('updates your own profile, and nobody else’s', async () => {
		// The session decides whose profile this is. An id in the path would be
		// an authorization question dressed up as routing.
		const email = unique('ada');
		await postJson<User>('/users', { name: 'Ada', email });
		const session = await signIn(email);

		const { status, body } = await patchJson<User>(
			'/me',
			{ name: 'Ada Lovelace' },
			{ headers: { cookie: session.cookie } },
		);

		expect(status).toBe(200);
		expect(body.name).toBe('Ada Lovelace');
		expect(body.email).toBe(email);
	});
});
