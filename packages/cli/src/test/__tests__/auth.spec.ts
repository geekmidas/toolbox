import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	loadPortState,
	parseComposePortMappings,
	rewriteUrlsWithPorts,
	savePortState,
} from '../../dev/index';
import { getDependencyEnvVars } from '../../workspace/index';
import { rewriteDatabaseUrlForTests } from '../index';
import {
	COMPOSE_FULL,
	createFullstackSecrets,
	createFullstackWorkspace,
	mapSecretsForApp,
} from './__fixtures__/workspace';

beforeAll(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
	vi.restoreAllMocks();
});

describe('auth app context', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `gkm-auth-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, 'docker-compose.yml'), COMPOSE_FULL);
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('should resolve DATABASE_URL from AUTH_DATABASE_URL', () => {
		const authSecrets = mapSecretsForApp(createFullstackSecrets(), 'auth');

		expect(authSecrets.DATABASE_URL).toBe(
			'postgresql://auth:auth-pass@localhost:5432/my-saas',
		);
		expect(authSecrets.AUTH_DATABASE_URL).toBe(
			'postgresql://auth:auth-pass@localhost:5432/my-saas',
		);
	});

	it('should preserve BETTER_AUTH_* secrets untouched', () => {
		const authSecrets = mapSecretsForApp(createFullstackSecrets(), 'auth');

		expect(authSecrets.BETTER_AUTH_SECRET).toBe('better-auth-secret-123');
		expect(authSecrets.BETTER_AUTH_URL).toBe('http://localhost:3002');
		expect(authSecrets.BETTER_AUTH_TRUSTED_ORIGINS).toBe(
			'http://localhost:3000,http://localhost:3001',
		);
	});

	it('should rewrite auth DATABASE_URL ports when postgres is remapped', async () => {
		await savePortState(testDir, {
			POSTGRES_HOST_PORT: 5433,
			REDIS_HOST_PORT: 6379,
		});

		let secrets = mapSecretsForApp(createFullstackSecrets(), 'auth');

		const mappings = parseComposePortMappings(
			join(testDir, 'docker-compose.yml'),
		);
		const ports = await loadPortState(testDir);
		secrets = rewriteUrlsWithPorts(secrets, {
			dockerEnv: {},
			ports,
			mappings,
		});

		expect(secrets.DATABASE_URL).toBe(
			'postgresql://auth:auth-pass@localhost:5433/my-saas',
		);
		expect(secrets.AUTH_DATABASE_URL).toBe(
			'postgresql://auth:auth-pass@localhost:5433/my-saas',
		);
		// BETTER_AUTH_URL is an app port (3002), not a docker service port
		expect(secrets.BETTER_AUTH_URL).toBe('http://localhost:3002');
		expect(secrets.BETTER_AUTH_SECRET).toBe('better-auth-secret-123');
		expect(secrets.BETTER_AUTH_TRUSTED_ORIGINS).toBe(
			'http://localhost:3000,http://localhost:3001',
		);
	});

	it('should apply _test suffix for gkm test in auth context', async () => {
		await savePortState(testDir, { POSTGRES_HOST_PORT: 5433 });

		let secrets = mapSecretsForApp(createFullstackSecrets(), 'auth');

		const mappings = parseComposePortMappings(
			join(testDir, 'docker-compose.yml'),
		);
		const ports = await loadPortState(testDir);
		secrets = rewriteUrlsWithPorts(secrets, {
			dockerEnv: {},
			ports,
			mappings,
		});
		secrets = rewriteDatabaseUrlForTests(secrets);

		// Port rewrite + _test suffix
		expect(secrets.DATABASE_URL).toBe(
			'postgresql://auth:auth-pass@localhost:5433/my-saas_test',
		);
		expect(secrets.AUTH_DATABASE_URL).toBe(
			'postgresql://auth:auth-pass@localhost:5433/my-saas_test',
		);
		// API_DATABASE_URL also gets _test (same container, different user)
		expect(secrets.API_DATABASE_URL).toBe(
			'postgresql://api:api-pass@localhost:5433/my-saas_test',
		);
	});

	it('should use default ports when no port state saved', async () => {
		let secrets = mapSecretsForApp(createFullstackSecrets(), 'auth');

		const mappings = parseComposePortMappings(
			join(testDir, 'docker-compose.yml'),
		);
		const ports = await loadPortState(testDir);

		// No saved state — rewriting is a no-op
		if (Object.keys(ports).length > 0) {
			secrets = rewriteUrlsWithPorts(secrets, {
				dockerEnv: {},
				ports,
				mappings,
			});
		}
		secrets = rewriteDatabaseUrlForTests(secrets);

		// Default port preserved, only _test suffix added
		expect(secrets.DATABASE_URL).toBe(
			'postgresql://auth:auth-pass@localhost:5432/my-saas_test',
		);
	});

	it('should not inject dependency URLs for auth app (no dependencies)', () => {
		const workspace = createFullstackWorkspace();
		const depEnv = getDependencyEnvVars(workspace, 'auth');

		expect(depEnv).toEqual({});
	});
});
