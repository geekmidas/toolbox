import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import {
	assertNoStaleSecrets,
	StaleStageSecrets,
	staleStageSecrets,
} from '../stale';

const manifest = {
	Database: { kind: 'database', id: 'Database', provides: ['DATABASE_URL'] },
	AuthDatabase: {
		kind: 'database-schema',
		id: 'AuthDatabase',
		of: 'Database',
		provides: ['AUTH_DATABASE_URL'],
	},
	Auth: {
		kind: 'rest-api',
		id: 'Auth',
		provides: ['AUTH_URL', 'AUTH_TRUSTED_ORIGINS', 'AUTH_COOKIE_DOMAIN'],
	},
	Web: { kind: 'site', id: 'Web', provides: ['WEB_URL'] },
	Shipping: {
		kind: 'external-api',
		id: 'Shipping',
		provides: ['SHIPPING_URL', 'SHIPPING_CREDENTIALS'],
	},
} as unknown as ConstructManifest;

describe('staleStageSecrets', () => {
	it('finds a tenant URL an older gkm stored, pointing at localhost', () => {
		expect(
			staleStageSecrets(manifest, {
				AUTH_DATABASE_URL: 'postgresql://auth:pw@localhost:5432/shop_dev',
				AUTH_DB_PASSWORD: 'pw',
			}),
		).toEqual([
			{
				key: 'AUTH_DATABASE_URL',
				construct: 'AuthDatabase',
				host: 'localhost',
			},
		]);
	});

	it('finds a surface and a site stored at http://localhost:<port>', () => {
		expect(
			staleStageSecrets(manifest, {
				AUTH_URL: 'http://localhost:3002',
				WEB_URL: 'http://127.0.0.1:3001',
			}).map((s) => s.key),
		).toEqual(['AUTH_URL', 'WEB_URL']);
	});

	it('passes a managed database the stage set with its real host', () => {
		expect(
			staleStageSecrets(manifest, {
				DATABASE_URL: 'postgres://app:pw@db.managed.example:5432/app',
				AUTH_DATABASE_URL: 'postgres://auth:pw@10.0.0.4:5432/app',
			}),
		).toEqual([]);
	});

	it("ignores what no construct provides an address for, and a construct's local host", () => {
		expect(
			staleStageSecrets(manifest, {
				// Not a construct's key at all.
				API_DATABASE_URL: 'postgresql://api:pw@localhost:5432/shop_dev',
				// A third party's: its own business.
				SHIPPING_URL: 'http://localhost:4010',
				// A host under `.localhost` is the local edge's, not this machine's.
				WEB_URL: 'https://shop.localhost:8443',
				// Not a URL.
				DATABASE_URL: 'not a url',
			}),
		).toEqual([]);
	});
});

describe('assertNoStaleSecrets', () => {
	it('throws naming each key and how to remove it, never the value', () => {
		const assert = () =>
			assertNoStaleSecrets({
				manifest,
				stage: 'production',
				supplied: {
					AUTH_DATABASE_URL: 'postgresql://auth:hunter2@localhost:5432/x',
					DATABASE_URL: 'postgresql://app:hunter2@localhost:5432/x',
				},
			});

		expect(assert).toThrow(StaleStageSecrets);
		try {
			assert();
		} catch (error) {
			const stale = error as StaleStageSecrets;
			expect(stale.stage).toBe('production');
			expect(stale.stale.map((s) => s.key)).toEqual([
				'AUTH_DATABASE_URL',
				'DATABASE_URL',
			]);
			expect(stale.message).toContain(
				'gkm secrets:unset AUTH_DATABASE_URL --stage production',
			);
			expect(stale.message).toContain(
				'gkm secrets:unset DATABASE_URL --stage production',
			);
			expect(stale.message).not.toContain('hunter2');
		}
	});

	it('passes a stage with nothing stale', () => {
		expect(() =>
			assertNoStaleSecrets({
				manifest,
				stage: 'production',
				supplied: { SHIPPING_CREDENTIALS: '{"apiKey":"k"}' },
			}),
		).not.toThrow();
	});
});
