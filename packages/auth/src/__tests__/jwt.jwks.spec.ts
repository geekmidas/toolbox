import * as jose from 'jose';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtVerifier } from '../jwt';

const JWKS_URI = 'https://issuer.test/.well-known/jwks.json';

let privateKey: CryptoKey;
let jwksRequests = 0;

const server = setupServer();

beforeAll(async () => {
	const pair = await jose.generateKeyPair('RS256', { extractable: true });
	privateKey = pair.privateKey;
	const jwk = {
		...(await jose.exportJWK(pair.publicKey)),
		kid: 'k1',
		alg: 'RS256',
	};
	server.use(
		http.get(JWKS_URI, () => {
			jwksRequests++;
			return HttpResponse.json({ keys: [jwk] });
		}),
	);
	server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => server.close());

const sign = (claims: Record<string, unknown>, key = privateKey) =>
	new jose.SignJWT(claims)
		.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
		.setIssuedAt()
		.setIssuer('https://issuer.test')
		.setExpirationTime('1h')
		.sign(key);

describe('JwtVerifier with a JWKS', () => {
	it('verifies a token against the published keys, fetching them once', async () => {
		const verifier = new JwtVerifier({
			jwksUri: JWKS_URI,
			issuer: 'https://issuer.test',
		});
		const before = jwksRequests;

		expect(await verifier.verify(await sign({ sub: 'u1' }))).toMatchObject({
			sub: 'u1',
		});
		expect(await verifier.verify(await sign({ sub: 'u2' }))).toMatchObject({
			sub: 'u2',
		});
		expect(jwksRequests - before).toBe(1);
	});

	it('rejects a token signed by a key the issuer does not publish', async () => {
		const verifier = new JwtVerifier({ jwksUri: JWKS_URI });
		const stranger = await jose.generateKeyPair('RS256');

		expect(
			await verifier.verifyOrNull(
				await sign({ sub: 'x' }, stranger.privateKey),
			),
		).toBeNull();
	});

	it('fetches the keys again after the cache is cleared', async () => {
		const verifier = new JwtVerifier({ jwksUri: JWKS_URI });
		await verifier.verify(await sign({ sub: 'u1' }));
		const before = jwksRequests;

		verifier.clearCache();
		await verifier.verify(await sign({ sub: 'u1' }));

		expect(jwksRequests - before).toBe(1);
	});

	it('holds a token to the algorithms it was configured with', async () => {
		const verifier = new JwtVerifier({
			jwksUri: JWKS_URI,
			algorithms: ['ES256'],
		});

		await expect(verifier.verify(await sign({ sub: 'u1' }))).rejects.toThrow();
	});
});
