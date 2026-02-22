import { describe, expect, it } from 'vitest';
import { generateFullstackCustomSecrets } from '../../setup/fullstack-secrets';
import type { NormalizedWorkspace } from '../../workspace/types';
import { reconcileMissingSecrets } from '../reconcile';
import type { StageSecrets } from '../types';

function createMultiAppWorkspace(
	overrides?: Partial<NormalizedWorkspace>,
): NormalizedWorkspace {
	return {
		name: 'test-project',
		root: '/tmp/test',
		apps: {
			api: {
				type: 'backend',
				path: 'apps/api',
				port: 3000,
				dependencies: [],
				resolvedDeployTarget: 'dokploy',
			},
			web: {
				type: 'frontend',
				path: 'apps/web',
				port: 3001,
				dependencies: ['api'],
				resolvedDeployTarget: 'dokploy',
				framework: 'nextjs',
			},
		},
		services: { db: true },
		deploy: {},
		shared: {},
		secrets: {},
		...overrides,
	} as NormalizedWorkspace;
}

function createSecrets(custom: Record<string, string> = {}): StageSecrets {
	return {
		stage: 'development',
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
		services: {},
		urls: {},
		custom,
	};
}

describe('reconcileMissingSecrets', () => {
	it('should return null for single-app workspace', () => {
		const workspace = createMultiAppWorkspace({
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
					resolvedDeployTarget: 'dokploy',
				},
			},
		}) as NormalizedWorkspace;

		const result = reconcileMissingSecrets(createSecrets(), workspace);
		expect(result).toBeNull();
	});

	it('should return null when no keys are missing', () => {
		const workspace = createMultiAppWorkspace();
		const expected = generateFullstackCustomSecrets(workspace);

		const result = reconcileMissingSecrets(createSecrets(expected), workspace);
		expect(result).toBeNull();
	});

	it('should backfill missing keys', () => {
		const workspace = createMultiAppWorkspace();
		const secrets = createSecrets();

		const result = reconcileMissingSecrets(secrets, workspace);

		expect(result).not.toBeNull();
		expect(result!.addedKeys.length).toBeGreaterThan(0);
		for (const key of result!.addedKeys) {
			expect(result!.secrets.custom[key]).toBeDefined();
		}
	});

	it('should never overwrite existing keys', () => {
		const workspace = createMultiAppWorkspace();
		const existingValue = 'my-custom-jwt-secret';
		const secrets = createSecrets({
			JWT_SECRET: existingValue,
		});

		const result = reconcileMissingSecrets(secrets, workspace);

		expect(result).not.toBeNull();
		expect(result!.secrets.custom.JWT_SECRET).toBe(existingValue);
		expect(result!.addedKeys).not.toContain('JWT_SECRET');
	});

	it('should update updatedAt timestamp', () => {
		const workspace = createMultiAppWorkspace();
		const secrets = createSecrets();
		const originalUpdatedAt = secrets.updatedAt;

		const result = reconcileMissingSecrets(secrets, workspace);

		expect(result).not.toBeNull();
		expect(result!.secrets.updatedAt).not.toBe(originalUpdatedAt);
	});

	it('should backfill frontend URL keys', () => {
		const workspace = createMultiAppWorkspace();
		const secrets = createSecrets();

		const result = reconcileMissingSecrets(secrets, workspace);

		expect(result).not.toBeNull();
		expect(result!.secrets.custom.WEB_URL).toBe('http://localhost:3001');
		expect(result!.addedKeys).toContain('WEB_URL');
	});
});
