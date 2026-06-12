import { describe, expect, it } from 'vitest';
import { ResourceType } from '../SstEnvironmentBuilder';
import {
	EnvValidationError,
	EnvValidator,
	platformEnvVars,
	resolveEnvKeys,
} from '../sst';

describe('SstEnvValidator', () => {
	describe('resolveEnvKeys', () => {
		it('derives all keys a Postgres link produces', () => {
			expect(resolveEnvKeys({ db: { type: ResourceType.Postgres } })).toEqual([
				'DB_NAME',
				'DB_HOST',
				'DB_PASSWORD',
				'DB_PORT',
				'DB_USERNAME',
				'DB_URL',
			]);
		});

		it('derives the bare key a Secret link produces', () => {
			expect(resolveEnvKeys({ apiKey: { type: ResourceType.Secret } })).toEqual(
				['API_KEY'],
			);
		});

		it('derives the suffixed key a Bucket link produces', () => {
			expect(
				resolveEnvKeys({ uploads: { type: ResourceType.Bucket } }),
			).toEqual(['UPLOADS_NAME']);
		});

		it('derives no keys for noop resource types', () => {
			expect(
				resolveEnvKeys({
					fn: { type: ResourceType.Function },
					api: { type: ResourceType.ApiGatewayV2 },
					net: { type: ResourceType.Vpc },
				}),
			).toEqual([]);
		});

		it('passes plain string entries through as a single env-cased key', () => {
			expect(resolveEnvKeys({ logLevel: 'debug' })).toEqual(['LOG_LEVEL']);
		});

		it('does not read resource values (keys only)', () => {
			const withValues = resolveEnvKeys({
				db: {
					type: ResourceType.Postgres,
					database: 'app',
					host: 'localhost',
					password: 'secret',
					port: 5432,
					username: 'user',
				},
			});
			expect(withValues).toEqual(
				resolveEnvKeys({ db: { type: ResourceType.Postgres } }),
			);
		});

		it('merges keys across multiple links', () => {
			const keys = resolveEnvKeys({
				db: { type: ResourceType.Postgres },
				cache: { type: ResourceType.Bucket },
			});
			expect(keys).toContain('DB_HOST');
			expect(keys).toContain('CACHE_NAME');
		});
	});

	describe('platform whitelists', () => {
		it('exposes per-platform runtime vars that differ', () => {
			expect(platformEnvVars('aws')).toContain('AWS_REGION');
			expect(platformEnvVars('gcp')).toContain('GOOGLE_CLOUD_PROJECT');
			expect(platformEnvVars('gcp')).not.toContain('AWS_REGION');
		});

		it('assumes no platform whitelist by default', () => {
			const validator = new EnvValidator({
				db: { type: ResourceType.Postgres },
			});
			expect(validator.has('AWS_REGION')).toBe(false);
		});

		it('trusts the AWS runtime vars only when platform: aws is set', () => {
			const validator = new EnvValidator(
				{ db: { type: ResourceType.Postgres } },
				{ platform: 'aws' },
			);
			expect(validator.has('AWS_REGION')).toBe(true);
			expect(validator.validate(['DB_HOST', 'AWS_REGION']).valid).toBe(true);
		});

		it('does not trust AWS vars when targeting gcp', () => {
			const validator = new EnvValidator(
				{ db: { type: ResourceType.Postgres } },
				{ platform: 'gcp' },
			);
			expect(validator.has('AWS_REGION')).toBe(false);
			expect(validator.has('GOOGLE_CLOUD_PROJECT')).toBe(true);
		});
	});

	describe('EnvValidator', () => {
		const links = {
			db: { type: ResourceType.Postgres },
			apiKey: { type: ResourceType.Secret },
		} as const;

		it('exposes available vars from links', () => {
			const validator = new EnvValidator(links);
			expect(validator.has('DB_HOST')).toBe(true);
			expect(validator.has('API_KEY')).toBe(true);
			expect(validator.has('NOT_THERE')).toBe(false);
		});

		it('validate() reports missing variables', () => {
			const validator = new EnvValidator(links);
			const result = validator.validate(['DB_HOST', 'MISSING_ONE']);
			expect(result.valid).toBe(false);
			expect(result.invalidVars).toEqual(['MISSING_ONE']);
		});

		it('validate() passes when every required var is available', () => {
			const validator = new EnvValidator(links);
			expect(validator.validate(['DB_HOST', 'DB_URL', 'API_KEY']).valid).toBe(
				true,
			);
		});

		it('treats `?`-suffixed variables as optional', () => {
			const validator = new EnvValidator(links);
			expect(validator.validate(['DB_HOST', 'SENTRY_DSN?']).valid).toBe(true);
		});

		it('honours an additional whitelist (e.g. explicit environment keys)', () => {
			const validator = new EnvValidator(links, { whitelist: ['APP_NAME'] });
			expect(validator.validate(['DB_HOST', 'APP_NAME']).valid).toBe(true);
		});
	});

	describe('getProvidersForEnvVars (least-privilege filtering)', () => {
		const validator = new EnvValidator({
			db: { type: ResourceType.Postgres },
			uploads: { type: ResourceType.Bucket },
			apiKey: { type: ResourceType.Secret },
		});

		it('returns only the links that provide a requested var', () => {
			expect(validator.getProvidersForEnvVars(['DB_HOST'])).toEqual(['db']);
		});

		it('returns multiple providers when several match', () => {
			const providers = validator.getProvidersForEnvVars([
				'DB_URL',
				'UPLOADS_NAME',
			]);
			expect(providers).toEqual(['db', 'uploads']);
		});

		it('ignores optional `?` markers', () => {
			expect(validator.getProvidersForEnvVars(['API_KEY?'])).toEqual([
				'apiKey',
			]);
		});

		it('returns nothing when no link provides the var', () => {
			expect(validator.getProvidersForEnvVars(['AWS_REGION'])).toEqual([]);
		});
	});

	describe('did-you-mean suggestions', () => {
		const validator = new EnvValidator({
			db: { type: ResourceType.Postgres },
			redis: { type: ResourceType.Secret },
		});

		it('suggests a renamed match (DATABASE_URL -> DB_URL)', () => {
			const { suggestions } = validator.validate(['DATABASE_URL']);
			expect(suggestions.DATABASE_URL).toContain('DB_URL');
		});

		it('suggests a near-typo match (DB_HSOT -> DB_HOST)', () => {
			const { suggestions } = validator.validate(['DB_HSOT']);
			expect(suggestions.DB_HSOT).toContain('DB_HOST');
		});

		it('offers no suggestion for an unrelated variable', () => {
			const { suggestions } = validator.validate(['STRIPE_SECRET_KEY']);
			expect(suggestions.STRIPE_SECRET_KEY).toBeUndefined();
		});
	});

	describe('EnvValidationError', () => {
		const links = { db: { type: ResourceType.Postgres } } as const;

		it('assert() throws an EnvValidationError with structured fields', () => {
			const validator = new EnvValidator(links, { context: 'orders-fn' });
			try {
				validator.assert(['DATABASE_URL', 'DB_HOST']);
				expect.unreachable('assert should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(EnvValidationError);
				const e = error as EnvValidationError;
				expect(e.missing).toEqual(['DATABASE_URL']);
				expect(e.context).toBe('orders-fn');
				expect(e.suggestions.DATABASE_URL).toContain('DB_URL');
				expect(e.message).toContain("'orders-fn'");
				expect(e.message).toContain('did you mean DB_URL?');
			}
		});

		it('assert() does not throw when all required vars are available', () => {
			const validator = new EnvValidator(links);
			expect(() => validator.assert(['DB_HOST', 'DB_URL'])).not.toThrow();
		});
	});
});
