import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, expect, it } from 'vitest';
import { JwtMiddleware } from '../hono/jwt';

const TEST_SECRET = 'super-secret-key-for-testing-only-32chars';

async function createTestToken(
	claims: Record<string, unknown> = {},
	secret = TEST_SECRET,
) {
	const secretKey = new TextEncoder().encode(secret);
	return await new jose.SignJWT({ sub: 'user-123', ...claims })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('1h')
		.sign(secretKey);
}

describe('JwtMiddleware', () => {
	describe('handler()', () => {
		it('should allow request with valid token', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({ config: { secret: TEST_SECRET } });

			app.use('/*', jwt.handler());
			app.get('/test', (c) => {
				const claims = c.get('jwtClaims');
				return c.json({ userId: claims.sub });
			});

			const token = await createTestToken();
			const res = await app.request('/test', {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.userId).toBe('user-123');
		});

		it('should reject request without token', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({ config: { secret: TEST_SECRET } });

			app.use('/*', jwt.handler());
			app.get('/test', (c) => c.json({ ok: true }));

			const res = await app.request('/test');

			expect(res.status).toBe(401);
		});

		it('should reject request with invalid token', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({ config: { secret: TEST_SECRET } });

			app.use('/*', jwt.handler());
			app.get('/test', (c) => c.json({ ok: true }));

			const res = await app.request('/test', {
				headers: { Authorization: 'Bearer invalid-token' },
			});

			expect(res.status).toBe(401);
		});

		it('should extract token from cookie when configured', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({
				config: { secret: TEST_SECRET },
				extraction: { cookieName: 'auth_token' },
			});

			app.use('/*', jwt.handler());
			app.get('/test', (c) => {
				const claims = c.get('jwtClaims');
				return c.json({ userId: claims.sub });
			});

			const token = await createTestToken();
			const res = await app.request('/test', {
				headers: { Cookie: `auth_token=${token}` },
			});

			expect(res.status).toBe(200);
		});

		it('should use custom context key', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({
				config: { secret: TEST_SECRET },
				contextKey: 'user',
			});

			app.use('/*', jwt.handler());
			app.get('/test', (c) => {
				const claims = c.get('user');
				return c.json({ userId: claims.sub });
			});

			const token = await createTestToken();
			const res = await app.request('/test', {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
		});

		it('should use custom error handler', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({
				config: { secret: TEST_SECRET },
				onError: (c) => c.json({ custom: 'error' }, 403),
			});

			app.use('/*', jwt.handler());
			app.get('/test', (c) => c.json({ ok: true }));

			const res = await app.request('/test');

			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.custom).toBe('error');
		});

		it('should transform claims', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({
				config: { secret: TEST_SECRET },
				transformClaims: (claims) => ({
					...claims,
					transformed: true,
				}),
			});

			app.use('/*', jwt.handler());
			app.get('/test', (c) => {
				const claims = c.get('jwtClaims');
				return c.json({ transformed: claims.transformed });
			});

			const token = await createTestToken();
			const res = await app.request('/test', {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.transformed).toBe(true);
		});

		it('should set jwtToken in context', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({ config: { secret: TEST_SECRET } });

			app.use('/*', jwt.handler());
			app.get('/test', (c) => {
				const token = c.get('jwtToken');
				return c.json({ hasToken: !!token });
			});

			const token = await createTestToken();
			const res = await app.request('/test', {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.hasToken).toBe(true);
		});
	});

	describe('optional()', () => {
		it('should allow request without token', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({ config: { secret: TEST_SECRET } });

			app.use('/*', jwt.optional());
			app.get('/test', (c) => {
				const claims = c.get('jwtClaims');
				return c.json({ authenticated: !!claims });
			});

			const res = await app.request('/test');

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.authenticated).toBe(false);
		});

		it('should set claims when valid token provided', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({ config: { secret: TEST_SECRET } });

			app.use('/*', jwt.optional());
			app.get('/test', (c) => {
				const claims = c.get('jwtClaims');
				return c.json({ authenticated: !!claims, userId: claims?.sub });
			});

			const token = await createTestToken();
			const res = await app.request('/test', {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.authenticated).toBe(true);
			expect(body.userId).toBe('user-123');
		});

		it('should not set claims for invalid token', async () => {
			const app = new Hono();
			const jwt = new JwtMiddleware({ config: { secret: TEST_SECRET } });

			app.use('/*', jwt.optional());
			app.get('/test', (c) => {
				const claims = c.get('jwtClaims');
				return c.json({ authenticated: !!claims });
			});

			const res = await app.request('/test', {
				headers: { Authorization: 'Bearer invalid-token' },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.authenticated).toBe(false);
		});
	});
});
