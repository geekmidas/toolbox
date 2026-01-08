// @vitest-environment node
import * as jose from 'jose';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { OidcVerifier } from '../oidc';

// Mock discovery document
const mockDiscovery = {
	issuer: 'https://auth.example.com',
	authorization_endpoint: 'https://auth.example.com/authorize',
	token_endpoint: 'https://auth.example.com/token',
	userinfo_endpoint: 'https://auth.example.com/userinfo',
	jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
	scopes_supported: ['openid', 'profile', 'email'],
	response_types_supported: ['code', 'token'],
	claims_supported: ['sub', 'name', 'email'],
};

// Mock user info
const mockUserInfo = {
	sub: 'user-123',
	name: 'Test User',
	email: 'test@example.com',
	email_verified: true,
};

// Test keys - stored in object so the mock can access after initialization
const testKeys: {
	privateKey: jose.KeyLike | null;
	publicKey: jose.KeyLike | null;
} = {
	privateKey: null,
	publicKey: null,
};
let jwks: jose.JSONWebKeySet;

async function setupKeys() {
	const keyPair = await jose.generateKeyPair('RS256');
	testKeys.privateKey = keyPair.privateKey;
	testKeys.publicKey = keyPair.publicKey;
	const publicJwk = await jose.exportJWK(keyPair.publicKey);
	jwks = {
		keys: [{ ...publicJwk, kid: 'test-key-id', use: 'sig', alg: 'RS256' }],
	};
}

// Mock createRemoteJWKSet to return test keys directly.
// MSW intercepts jose's fetch in standalone scripts but fails in vitest for unknown reasons.
// TODO: Investigate vitest/MSW/jose interaction and remove this mock if possible.
vi.mock('jose', async (importOriginal) => {
	const actual = await importOriginal<typeof jose>();
	return {
		...actual,
		createRemoteJWKSet: () => {
			return async (protectedHeader: jose.JWSHeaderParameters) => {
				if (protectedHeader.kid === 'test-key-id' && testKeys.publicKey) {
					return testKeys.publicKey;
				}
				throw new Error(`Unknown key ID: ${protectedHeader.kid}`);
			};
		},
	};
});

async function createTestToken(
	claims: Record<string, unknown> = {},
	options: { expiresIn?: string } = {},
) {
	if (!testKeys.privateKey) {
		throw new Error('Keys not initialized');
	}
	return await new jose.SignJWT({ sub: 'user-123', ...claims })
		.setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
		.setIssuedAt()
		.setIssuer('https://auth.example.com')
		.setAudience('my-api')
		.setExpirationTime(options.expiresIn ?? '1h')
		.sign(testKeys.privateKey);
}

// MSW server for discovery, userinfo, and other HTTP endpoints
const server = setupServer(
	http.get('https://auth.example.com/.well-known/openid-configuration', () => {
		return HttpResponse.json(mockDiscovery);
	}),
	http.get('https://auth.example.com/.well-known/jwks.json', () => {
		return HttpResponse.json(jwks);
	}),
	http.get('https://auth.example.com/userinfo', () => {
		return HttpResponse.json(mockUserInfo);
	}),
	http.get(
		'https://other-auth.example.com/.well-known/openid-configuration',
		() => {
			return HttpResponse.json({
				...mockDiscovery,
				issuer: 'https://other-auth.example.com',
				jwks_uri: 'https://other-auth.example.com/.well-known/jwks.json',
			});
		},
	),
	http.get('https://other-auth.example.com/.well-known/jwks.json', () => {
		return HttpResponse.json(jwks);
	}),
);

describe('OidcVerifier', () => {
	beforeAll(async () => {
		await setupKeys();
		server.listen({ onUnhandledRequest: 'error' });
	});

	afterEach(() => {
		server.resetHandlers();
	});

	afterAll(() => {
		server.close();
	});

	describe('getDiscovery', () => {
		it('should fetch OIDC discovery document', async () => {
			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});

			const discovery = await verifier.getDiscovery();

			expect(discovery.issuer).toBe('https://auth.example.com');
			expect(discovery.jwks_uri).toBe(
				'https://auth.example.com/.well-known/jwks.json',
			);
		});

		it('should cache discovery document by default', async () => {
			let callCount = 0;
			server.use(
				http.get(
					'https://auth.example.com/.well-known/openid-configuration',
					() => {
						callCount++;
						return HttpResponse.json(mockDiscovery);
					},
				),
			);

			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});

			await verifier.getDiscovery();
			await verifier.getDiscovery();

			expect(callCount).toBe(1);
		});

		it('should handle issuer with trailing slash', async () => {
			let requestedUrl = '';
			server.use(
				http.get(
					'https://auth.example.com/.well-known/openid-configuration',
					({ request }) => {
						requestedUrl = request.url;
						return HttpResponse.json(mockDiscovery);
					},
				),
			);

			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com/',
				audience: 'my-api',
			});

			await verifier.getDiscovery();

			expect(requestedUrl).toBe(
				'https://auth.example.com/.well-known/openid-configuration',
			);
		});

		it('should throw on failed discovery fetch', async () => {
			server.use(
				http.get(
					'https://auth.example.com/.well-known/openid-configuration',
					() => {
						return new HttpResponse(null, {
							status: 500,
							statusText: 'Internal Server Error',
						});
					},
				),
			);

			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});

			await expect(verifier.getDiscovery()).rejects.toThrow(
				'Failed to fetch OIDC discovery',
			);
		});
	});

	describe('verify', () => {
		it('should verify a valid token', async () => {
			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});
			const token = await createTestToken();

			const claims = await verifier.verify(token);

			expect(claims.sub).toBe('user-123');
		});

		it('should throw for invalid token', async () => {
			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});

			await expect(verifier.verify('invalid-token')).rejects.toThrow();
		});

		it('should throw for expired token', async () => {
			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});
			const token = await createTestToken({}, { expiresIn: '-1h' });

			await expect(verifier.verify(token)).rejects.toThrow();
		});

		it('should throw for wrong issuer', async () => {
			const verifier = new OidcVerifier({
				issuer: 'https://other-auth.example.com',
				audience: 'my-api',
			});
			const token = await createTestToken();

			await expect(verifier.verify(token)).rejects.toThrow();
		});

		it('should throw for wrong audience', async () => {
			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'other-api',
			});
			const token = await createTestToken();

			await expect(verifier.verify(token)).rejects.toThrow();
		});
	});

	describe('verifyOrNull', () => {
		it('should return claims for valid token', async () => {
			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});
			const token = await createTestToken();

			const claims = await verifier.verifyOrNull(token);

			expect(claims).not.toBeNull();
			expect(claims?.sub).toBe('user-123');
		});

		it('should return null for invalid token', async () => {
			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});

			const claims = await verifier.verifyOrNull('invalid-token');

			expect(claims).toBeNull();
		});
	});

	describe('fetchUserInfo', () => {
		it('should fetch user info with valid token', async () => {
			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});
			const token = await createTestToken();

			const userInfo = await verifier.fetchUserInfo(token);

			expect(userInfo).not.toBeNull();
			expect(userInfo?.sub).toBe('user-123');
			expect(userInfo?.name).toBe('Test User');
			expect(userInfo?.email).toBe('test@example.com');
		});

		it('should return null when userinfo endpoint is not available', async () => {
			server.use(
				http.get(
					'https://auth.example.com/.well-known/openid-configuration',
					() => {
						return HttpResponse.json({
							...mockDiscovery,
							userinfo_endpoint: undefined,
						});
					},
				),
			);

			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});

			const userInfo = await verifier.fetchUserInfo('some-token');

			expect(userInfo).toBeNull();
		});

		it('should return null on userinfo fetch error', async () => {
			server.use(
				http.get('https://auth.example.com/userinfo', () => {
					return new HttpResponse(null, { status: 401 });
				}),
			);

			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});

			const userInfo = await verifier.fetchUserInfo('invalid-token');

			expect(userInfo).toBeNull();
		});
	});

	describe('clearCache', () => {
		it('should clear cached discovery and jwks', async () => {
			let callCount = 0;
			server.use(
				http.get(
					'https://auth.example.com/.well-known/openid-configuration',
					() => {
						callCount++;
						return HttpResponse.json(mockDiscovery);
					},
				),
			);

			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
			});

			await verifier.getDiscovery();
			expect(callCount).toBe(1);

			verifier.clearCache();

			await verifier.getDiscovery();
			expect(callCount).toBe(2);
		});
	});

	describe('cacheDiscovery option', () => {
		it('should not cache when cacheDiscovery is false', async () => {
			let callCount = 0;
			server.use(
				http.get(
					'https://auth.example.com/.well-known/openid-configuration',
					() => {
						callCount++;
						return HttpResponse.json(mockDiscovery);
					},
				),
			);

			const verifier = new OidcVerifier({
				issuer: 'https://auth.example.com',
				audience: 'my-api',
				cacheDiscovery: false,
			});

			await verifier.getDiscovery();
			await verifier.getDiscovery();

			expect(callCount).toBe(2);
		});
	});
});
