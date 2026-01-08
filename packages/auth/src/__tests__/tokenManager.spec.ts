import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenManager, type TokenPayload } from '../tokenManager.ts';

describe('TokenManager', () => {
	let tokenManager: TokenManager;
	let userPayload: TokenPayload;

	beforeEach(() => {
		tokenManager = new TokenManager({
			accessTokenSecret: 'test-access-secret',
			refreshTokenSecret: 'test-refresh-secret',
			accessTokenExpiresIn: '15m',
			refreshTokenExpiresIn: '7d',
		});

		userPayload = {
			userId: 'user123',
			email: 'test@example.com',
			role: 'admin',
		};
	});

	describe('token generation and verification workflow', () => {
		it('should generate and verify complete token pair', () => {
			const { accessToken, refreshToken } =
				tokenManager.generateTokenPair(userPayload);

			const accessDecoded = tokenManager.verifyAccessToken(accessToken);
			const refreshDecoded = tokenManager.verifyRefreshToken(refreshToken);

			expect(accessDecoded.userId).toBe(userPayload.userId);
			expect(accessDecoded.email).toBe(userPayload.email);
			expect(accessDecoded.role).toBe(userPayload.role);
			expect(refreshDecoded.userId).toBe(userPayload.userId);
			expect(refreshDecoded.email).toBe(userPayload.email);
			expect(refreshDecoded.role).toBe(userPayload.role);
		});

		it('should handle complete token refresh workflow', () => {
			const { refreshToken } = tokenManager.generateTokenPair(userPayload);

			const newAccessToken = tokenManager.refreshAccessToken(refreshToken);
			const newDecoded = tokenManager.verifyAccessToken(newAccessToken);

			expect(newDecoded.userId).toBe(userPayload.userId);
			expect(newDecoded.email).toBe(userPayload.email);
			expect(newDecoded.role).toBe(userPayload.role);
			expect(newDecoded.iat).toBeDefined();
			expect(newDecoded.exp).toBeDefined();
		});

		it('should maintain payload integrity through refresh cycle', () => {
			const originalPayload = {
				userId: 'user456',
				email: 'user@example.com',
				permissions: ['read', 'write'],
				metadata: { department: 'engineering' },
			};

			const { refreshToken } = tokenManager.generateTokenPair(originalPayload);
			const newAccessToken = tokenManager.refreshAccessToken(refreshToken);
			const decoded = tokenManager.verifyAccessToken(newAccessToken);

			expect(decoded.userId).toBe(originalPayload.userId);
			expect(decoded.email).toBe(originalPayload.email);
			expect(decoded.permissions).toEqual(originalPayload.permissions);
			expect(decoded.metadata).toEqual(originalPayload.metadata);
		});
	});

	describe('token expiration handling', () => {
		it('should correctly identify token expiration status', () => {
			const { accessToken } = tokenManager.generateTokenPair(userPayload);

			expect(tokenManager.isTokenExpired(accessToken)).toBe(false);

			const expiration = tokenManager.getTokenExpiration(accessToken);
			expect(expiration).toBeInstanceOf(Date);
			expect(expiration!.getTime()).toBeGreaterThan(Date.now());
		});

		it('should handle expired tokens correctly', async () => {
			vi.useFakeTimers();
			const shortLivedManager = new TokenManager({
				accessTokenSecret: 'test-access-secret',
				refreshTokenSecret: 'test-refresh-secret',
				accessTokenExpiresIn: '10m',
			});

			const { accessToken } = shortLivedManager.generateTokenPair(userPayload);

			vi.advanceTimersByTime(1000 * 60 * 16); // Fast-forward time to expire access token

			expect(tokenManager.isTokenExpired(accessToken)).toBe(true);

			vi.useRealTimers();
		});

		it('should decode tokens without verification', () => {
			const { accessToken } = tokenManager.generateTokenPair(userPayload);

			const decoded = tokenManager.decodeToken(accessToken);

			expect(decoded).not.toBeNull();
			expect(decoded!.userId).toBe(userPayload.userId);
			expect(decoded!.email).toBe(userPayload.email);
		});
	});

	describe('security validation', () => {
		it('should reject tokens with invalid signatures', () => {
			const wrongSecretManager = new TokenManager({
				accessTokenSecret: 'wrong-secret',
				refreshTokenSecret: 'test-refresh-secret',
			});

			const { accessToken } = wrongSecretManager.generateTokenPair(userPayload);

			expect(() => {
				tokenManager.verifyAccessToken(accessToken);
			}).toThrow('Invalid access token');
		});

		it('should reject malformed tokens', () => {
			expect(() => {
				tokenManager.verifyAccessToken('invalid-token');
			}).toThrow('Invalid access token');

			expect(() => {
				tokenManager.verifyRefreshToken('invalid-token');
			}).toThrow('Invalid refresh token');

			expect(() => {
				tokenManager.refreshAccessToken('invalid-token');
			}).toThrow('Invalid refresh token');
		});

		it('should handle cross-secret validation correctly', () => {
			const { accessToken, refreshToken } =
				tokenManager.generateTokenPair(userPayload);

			// Access token should not verify with refresh secret
			expect(() => {
				tokenManager.verifyRefreshToken(accessToken);
			}).toThrow('Invalid refresh token');

			// Refresh token should not verify with access secret
			expect(() => {
				tokenManager.verifyAccessToken(refreshToken);
			}).toThrow('Invalid access token');
		});
	});

	describe('configuration flexibility', () => {
		it('should support custom expiration times', () => {
			const customManager = new TokenManager({
				accessTokenSecret: 'test-access-secret',
				refreshTokenSecret: 'test-refresh-secret',
				accessTokenExpiresIn: '1h',
				refreshTokenExpiresIn: '30d',
			});

			const { accessToken, refreshToken } =
				customManager.generateTokenPair(userPayload);

			const accessDecoded = customManager.verifyAccessToken(accessToken);
			const refreshDecoded = customManager.verifyRefreshToken(refreshToken);

			const accessExpTime = (accessDecoded.exp - accessDecoded.iat) * 1000;
			const refreshExpTime = (refreshDecoded.exp - refreshDecoded.iat) * 1000;

			// Access token should be ~1 hour
			expect(accessExpTime).toBeGreaterThan(55 * 60 * 1000);
			expect(accessExpTime).toBeLessThan(65 * 60 * 1000);

			// Refresh token should be ~30 days
			expect(refreshExpTime).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
			expect(refreshExpTime).toBeLessThan(31 * 24 * 60 * 60 * 1000);
		});

		it('should use default expiration times', () => {
			const defaultManager = new TokenManager({
				accessTokenSecret: 'test-access-secret',
				refreshTokenSecret: 'test-refresh-secret',
			});

			const { accessToken, refreshToken } =
				defaultManager.generateTokenPair(userPayload);

			const accessDecoded = defaultManager.verifyAccessToken(accessToken);
			const refreshDecoded = defaultManager.verifyRefreshToken(refreshToken);

			const accessExpTime = (accessDecoded.exp - accessDecoded.iat) * 1000;
			const refreshExpTime = (refreshDecoded.exp - refreshDecoded.iat) * 1000;

			// Default access token should be ~15 minutes
			expect(accessExpTime).toBeGreaterThan(14 * 60 * 1000);
			expect(accessExpTime).toBeLessThan(16 * 60 * 1000);

			// Default refresh token should be ~7 days
			expect(refreshExpTime).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
			expect(refreshExpTime).toBeLessThan(8 * 24 * 60 * 60 * 1000);
		});
	});

	describe('edge cases and error handling', () => {
		it('should handle empty payload gracefully', () => {
			const emptyPayload = { userId: '' };

			const { accessToken, refreshToken } =
				tokenManager.generateTokenPair(emptyPayload);

			const accessDecoded = tokenManager.verifyAccessToken(accessToken);
			const refreshDecoded = tokenManager.verifyRefreshToken(refreshToken);

			expect(accessDecoded.userId).toBe('');
			expect(refreshDecoded.userId).toBe('');
		});

		it('should handle large payloads correctly', () => {
			const largePayload = {
				userId: 'user123',
				permissions: Array.from({ length: 100 }, (_, i) => `permission_${i}`),
				metadata: {
					department: 'engineering',
					team: 'platform',
					projects: Array.from({ length: 50 }, (_, i) => `project_${i}`),
				},
			};

			const { accessToken, refreshToken } =
				tokenManager.generateTokenPair(largePayload);

			const accessDecoded = tokenManager.verifyAccessToken(accessToken);
			const refreshDecoded = tokenManager.verifyRefreshToken(refreshToken);

			expect(accessDecoded.userId).toBe(largePayload.userId);
			expect(accessDecoded.permissions).toEqual(largePayload.permissions);
			expect(accessDecoded.metadata).toEqual(largePayload.metadata);
			expect(refreshDecoded.userId).toBe(largePayload.userId);
			expect(refreshDecoded.permissions).toEqual(largePayload.permissions);
			expect(refreshDecoded.metadata).toEqual(largePayload.metadata);
		});

		it('should return null for completely invalid tokens', () => {
			expect(tokenManager.decodeToken('')).toBeNull();
			expect(tokenManager.decodeToken('not.a.token')).toBeNull();
			expect(tokenManager.decodeToken('invalid-token')).toBeNull();

			expect(tokenManager.getTokenExpiration('')).toBeNull();
			expect(tokenManager.getTokenExpiration('not.a.token')).toBeNull();
			expect(tokenManager.getTokenExpiration('invalid-token')).toBeNull();

			expect(tokenManager.isTokenExpired('')).toBe(true);
			expect(tokenManager.isTokenExpired('not.a.token')).toBe(true);
			expect(tokenManager.isTokenExpired('invalid-token')).toBe(true);
		});
	});
});
