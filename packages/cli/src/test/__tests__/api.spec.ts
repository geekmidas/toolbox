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

describe('api app context', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `gkm-api-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, 'docker-compose.yml'), COMPOSE_FULL);
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('should resolve DATABASE_URL from API_DATABASE_URL', () => {
		const apiSecrets = mapSecretsForApp(
			createFullstackSecrets(),
			'api',
		);

		expect(apiSecrets.DATABASE_URL).toBe(
			'postgresql://api:api-pass@localhost:5432/my-saas',
		);
		expect(apiSecrets.API_DATABASE_URL).toBe(
			'postgresql://api:api-pass@localhost:5432/my-saas',
		);
	});

	it('should rewrite DATABASE_URL and REDIS_URL when ports are remapped', async () => {
		await savePortState(testDir, {
			POSTGRES_HOST_PORT: 5433,
			REDIS_HOST_PORT: 6380,
		});

		let secrets = mapSecretsForApp(createFullstackSecrets(), 'api');

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
			'postgresql://api:api-pass@localhost:5433/my-saas',
		);
		expect(secrets.API_DATABASE_URL).toBe(
			'postgresql://api:api-pass@localhost:5433/my-saas',
		);
		expect(secrets.REDIS_URL).toBe(
			'redis://:redis-pass@localhost:6380',
		);
		// AUTH_URL is an app URL, not a docker service
		expect(secrets.AUTH_URL).toBe('http://localhost:3002');
	});

	it('should rewrite only postgres when redis port unchanged', async () => {
		await savePortState(testDir, {
			POSTGRES_HOST_PORT: 5433,
			REDIS_HOST_PORT: 6379,
		});

		let secrets = mapSecretsForApp(createFullstackSecrets(), 'api');

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
			'postgresql://api:api-pass@localhost:5433/my-saas',
		);
		// Redis port unchanged — URL stays the same
		expect(secrets.REDIS_URL).toBe(
			'redis://:redis-pass@localhost:6379',
		);
	});

	it('should apply full pipeline for gkm test in api context', async () => {
		await savePortState(testDir, {
			POSTGRES_HOST_PORT: 5433,
			REDIS_HOST_PORT: 6380,
		});

		let secrets = mapSecretsForApp(createFullstackSecrets(), 'api');

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
			'postgresql://api:api-pass@localhost:5433/my-saas_test',
		);
		expect(secrets.API_DATABASE_URL).toBe(
			'postgresql://api:api-pass@localhost:5433/my-saas_test',
		);
		// AUTH_DATABASE_URL also gets both rewrites
		expect(secrets.AUTH_DATABASE_URL).toBe(
			'postgresql://auth:auth-pass@localhost:5433/my-saas_test',
		);
		// Non-database URLs unaffected
		expect(secrets.REDIS_URL).toBe(
			'redis://:redis-pass@localhost:6380',
		);
		expect(secrets.AUTH_URL).toBe('http://localhost:3002');
	});

	it('should use default ports when no port state saved', async () => {
		let secrets = mapSecretsForApp(createFullstackSecrets(), 'api');

		const mappings = parseComposePortMappings(
			join(testDir, 'docker-compose.yml'),
		);
		const ports = await loadPortState(testDir);

		if (Object.keys(ports).length > 0) {
			secrets = rewriteUrlsWithPorts(secrets, {
				dockerEnv: {},
				ports,
				mappings,
			});
		}
		secrets = rewriteDatabaseUrlForTests(secrets);

		expect(secrets.DATABASE_URL).toBe(
			'postgresql://api:api-pass@localhost:5432/my-saas_test',
		);
		expect(secrets.REDIS_URL).toBe(
			'redis://:redis-pass@localhost:6379',
		);
	});

	it('should not inject dependency URLs for api app (no dependencies)', () => {
		const workspace = createFullstackWorkspace();
		const depEnv = getDependencyEnvVars(workspace, 'api');

		expect(depEnv).toEqual({});
	});

	it('should keep BETTER_AUTH vars available for api to call auth service', async () => {
		await savePortState(testDir, { POSTGRES_HOST_PORT: 5433 });

		let secrets = mapSecretsForApp(createFullstackSecrets(), 'api');

		const mappings = parseComposePortMappings(
			join(testDir, 'docker-compose.yml'),
		);
		const ports = await loadPortState(testDir);
		secrets = rewriteUrlsWithPorts(secrets, {
			dockerEnv: {},
			ports,
			mappings,
		});

		// API app may need AUTH_URL to call auth service internally
		expect(secrets.AUTH_URL).toBe('http://localhost:3002');
		expect(secrets.BETTER_AUTH_URL).toBe('http://localhost:3002');
	});
});
