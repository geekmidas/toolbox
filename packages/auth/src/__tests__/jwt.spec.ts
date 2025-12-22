import * as jose from 'jose';
import { describe, expect, it } from 'vitest';
import { JwtVerifier, decodeJwt } from '../jwt';

const TEST_SECRET = 'super-secret-key-for-testing-only-32chars';

async function createTestToken(
  claims: Record<string, unknown> = {},
  options: {
    secret?: string;
    expiresIn?: string;
    issuer?: string;
    audience?: string;
  } = {},
) {
  const secret = new TextEncoder().encode(options.secret ?? TEST_SECRET);
  const jwt = new jose.SignJWT({ sub: 'user-123', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt();

  if (options.expiresIn) {
    jwt.setExpirationTime(options.expiresIn);
  } else {
    jwt.setExpirationTime('1h');
  }

  if (options.issuer) {
    jwt.setIssuer(options.issuer);
  }

  if (options.audience) {
    jwt.setAudience(options.audience);
  }

  return await jwt.sign(secret);
}

describe('JwtVerifier', () => {
  describe('with secret', () => {
    it('should verify a valid token', async () => {
      const verifier = new JwtVerifier({ secret: TEST_SECRET });
      const token = await createTestToken();

      const claims = await verifier.verify(token);

      expect(claims.sub).toBe('user-123');
    });

    it('should throw for invalid token', async () => {
      const verifier = new JwtVerifier({ secret: TEST_SECRET });

      await expect(verifier.verify('invalid-token')).rejects.toThrow();
    });

    it('should throw for wrong secret', async () => {
      const verifier = new JwtVerifier({ secret: TEST_SECRET });
      const token = await createTestToken(
        {},
        { secret: 'wrong-secret-key-32-chars-long!!' },
      );

      await expect(verifier.verify(token)).rejects.toThrow();
    });

    it('should throw for expired token', async () => {
      const verifier = new JwtVerifier({ secret: TEST_SECRET });
      const token = await createTestToken({}, { expiresIn: '-1h' });

      await expect(verifier.verify(token)).rejects.toThrow();
    });

    it('should validate issuer when configured', async () => {
      const verifier = new JwtVerifier({
        secret: TEST_SECRET,
        issuer: 'my-app',
      });

      const validToken = await createTestToken({}, { issuer: 'my-app' });
      const invalidToken = await createTestToken({}, { issuer: 'other-app' });

      await expect(verifier.verify(validToken)).resolves.toBeDefined();
      await expect(verifier.verify(invalidToken)).rejects.toThrow();
    });

    it('should validate audience when configured', async () => {
      const verifier = new JwtVerifier({
        secret: TEST_SECRET,
        audience: 'my-api',
      });

      const validToken = await createTestToken({}, { audience: 'my-api' });
      const invalidToken = await createTestToken({}, { audience: 'other-api' });

      await expect(verifier.verify(validToken)).resolves.toBeDefined();
      await expect(verifier.verify(invalidToken)).rejects.toThrow();
    });
  });

  describe('verifyOrNull', () => {
    it('should return claims for valid token', async () => {
      const verifier = new JwtVerifier({ secret: TEST_SECRET });
      const token = await createTestToken();

      const claims = await verifier.verifyOrNull(token);

      expect(claims).not.toBeNull();
      expect(claims?.sub).toBe('user-123');
    });

    it('should return null for invalid token', async () => {
      const verifier = new JwtVerifier({ secret: TEST_SECRET });

      const claims = await verifier.verifyOrNull('invalid-token');

      expect(claims).toBeNull();
    });

    it('should return null for expired token', async () => {
      const verifier = new JwtVerifier({ secret: TEST_SECRET });
      const token = await createTestToken({}, { expiresIn: '-1h' });

      const claims = await verifier.verifyOrNull(token);

      expect(claims).toBeNull();
    });
  });

  describe('custom claims', () => {
    interface CustomClaims {
      sub?: string;
      role: string;
      permissions: string[];
    }

    it('should return typed claims', async () => {
      const verifier = new JwtVerifier<CustomClaims>({ secret: TEST_SECRET });
      const token = await createTestToken({
        role: 'admin',
        permissions: ['read', 'write'],
      });

      const claims = await verifier.verify(token);

      expect(claims.role).toBe('admin');
      expect(claims.permissions).toEqual(['read', 'write']);
    });
  });
});

describe('decodeJwt', () => {
  it('should decode token without verification', async () => {
    const token = await createTestToken({ custom: 'data' });

    const claims = decodeJwt(token);

    expect(claims.sub).toBe('user-123');
    expect(claims).toHaveProperty('custom', 'data');
  });

  it('should decode token even with wrong secret', async () => {
    const token = await createTestToken(
      {},
      { secret: 'any-secret-32-characters-long!!' },
    );

    const claims = decodeJwt(token);

    expect(claims.sub).toBe('user-123');
  });

  it('should throw for malformed token', () => {
    expect(() => decodeJwt('not.a.valid.jwt')).toThrow();
  });
});
