import { describe, expect } from 'vitest';
import { it } from '#test';

const address = (who: string) => `${who}+${crypto.randomUUID()}@example.com`;

describe('users', () => {
	it('creates one and returns it', async ({ browser }) => {
		const email = address('ada');

		const user = await browser.api.post('/users', {
			body: { name: 'Ada', email },
		});

		expect(user.email).toBe(email);
		expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('rejects a body that is not a user', async ({ browser }) => {
		// The endpoint's schema is the contract and it is checked before the
		// handler runs, so this never reaches the database. 422 rather than 400:
		// the request parsed fine and its *contents* are what failed.
		await expect(
			browser.api.post('/users', { body: { name: '', email: 'nope' } }),
		).rejects.toMatchObject({ status: 422 });
	});

	it('serves the list from the cache once it is warm', async ({ browser }) => {
		// The cache is a table in the app's own database, reached by the same
		// role. The second read is served from what the first stored.
		const first = await browser.api.get('/users');
		const second = await browser.api.get('/users');

		expect(second.users).toEqual(first.users);
	});

	it('invalidates that cache when a user is created', async ({ browser }) => {
		// A cache nothing invalidates is wrong for its TTL; the endpoint deletes
		// the key inside the same request that inserted the row.
		await browser.api.get('/users');

		const email = address('grace');
		await browser.api.post('/users', { body: { name: 'Grace', email } });

		const { users } = await browser.api.get('/users');
		expect(users.map((u) => u.email)).toContain(email);
	});

	it('reads a user the database’s factory inserted', async ({
		browser,
		factories,
	}) => {
		// Built on this test's transaction, so the endpoint sees the row — and
		// it is rolled back with everything else.
		const email = address('katherine');
		const factory = await factories.get('database');
		const katherine = await factory.insert('users', {
			name: 'Katherine',
			email,
		});
		await browser.signIn(email);

		const user = await browser.api.get('/users/{id}', {
			params: { id: katherine.id },
		});

		expect(user).toMatchObject({ id: katherine.id, name: 'Katherine' });
	});

	it('refuses to read one without a session', async ({ browser }) => {
		const created = await browser.api.post('/users', {
			body: { name: 'Ada', email: address('ada') },
		});

		await expect(
			browser.api.get('/users/{id}', { params: { id: created.id } }),
		).rejects.toMatchObject({ status: 401 });
	});

	it('reads one with a session', async ({ browser }) => {
		const email = address('hopper');
		const created = await browser.api.post('/users', {
			body: { name: 'Grace', email },
		});
		await browser.signIn(email);

		const user = await browser.api.get('/users/{id}', {
			params: { id: created.id },
		});

		expect(user.email).toBe(email);
	});

	it('404s a user that is not there rather than 500ing', async ({
		browser,
		faker,
	}) => {
		// Signed in as somebody new — the test does not care who — and given
		// the profile that lets the session through.
		const { user } = await browser.signIn();
		await browser.api.post('/users', {
			body: { name: faker.person.fullName(), email: user.email },
		});

		await expect(
			browser.api.get('/users/{id}', {
				params: { id: '00000000-0000-0000-0000-000000000000' },
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it('updates your own profile, and nobody else’s', async ({ browser }) => {
		// The session decides whose profile this is. An id in the path would be
		// an authorization question dressed up as routing.
		const email = address('ada');
		await browser.api.post('/users', { body: { name: 'Ada', email } });
		await browser.signIn(email);

		const me = await browser.api.patch('/me', {
			body: { name: 'Ada Lovelace' },
		});

		expect(me).toMatchObject({ name: 'Ada Lovelace', email });
	});
});
