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
import { getDependencyEnvVars, normalizeWorkspace } from '../../workspace/index';
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

describe('web (frontend) app context', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `gkm-web-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, 'docker-compose.yml'), COMPOSE_FULL);
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('should inject both NEXT_PUBLIC_ and server-side dependency URLs', () => {
		const workspace = createFullstackWorkspace();
		const depEnv = getDependencyEnvVars(workspace, 'web');

		expect(depEnv).toEqual({
			API_URL: 'http://localhost:3000',
			NEXT_PUBLIC_API_URL: 'http://localhost:3000',
			AUTH_URL: 'http://localhost:3002',
			NEXT_PUBLIC_AUTH_URL: 'http://localhost:3002',
		});
	});

	it('should not rewrite dependency URLs with docker ports (app ports are fixed)', async () => {
		await savePortState(testDir, {
			POSTGRES_HOST_PORT: 5433,
			REDIS_HOST_PORT: 6380,
		});

		const workspace = createFullstackWorkspace();
		const depEnv = getDependencyEnvVars(workspace, 'web');

		// Dependency URLs use app ports (3000, 3002), not docker service ports
		// Port rewriting should not affect them
		expect(depEnv.API_URL).toBe('http://localhost:3000');
		expect(depEnv.AUTH_URL).toBe('http://localhost:3002');
		expect(depEnv.NEXT_PUBLIC_API_URL).toBe('http://localhost:3000');
		expect(depEnv.NEXT_PUBLIC_AUTH_URL).toBe('http://localhost:3002');
	});

	it('should not have DATABASE_URL (frontend does not access database)', () => {
		// Frontend gets secrets mapped without an app-specific DATABASE_URL
		const secrets = mapSecretsForApp(createFullstackSecrets(), 'web');

		// No WEB_DATABASE_URL exists, so DATABASE_URL stays as default (api's)
		// In practice, frontend apps don't use DATABASE_URL at all
		const workspace = createFullstackWorkspace();
		const depEnv = getDependencyEnvVars(workspace, 'web');

		// depEnv should not contain DATABASE_URL
		expect(depEnv.DATABASE_URL).toBeUndefined();
		expect(depEnv.NEXT_PUBLIC_DATABASE_URL).toBeUndefined();
	});

	it('should handle workspace with single dependency', () => {
		const workspace = normalizeWorkspace(
			{
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/endpoints/**/*.ts',
						dependencies: [],
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						framework: 'nextjs',
						dependencies: ['api'],
					},
				},
			},
			'/project',
		);

		const depEnv = getDependencyEnvVars(workspace, 'web');

		expect(depEnv).toEqual({
			API_URL: 'http://localhost:3000',
			NEXT_PUBLIC_API_URL: 'http://localhost:3000',
		});
	});

	it('should handle workspace with many dependencies', () => {
		const workspace = normalizeWorkspace(
			{
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						routes: './src/endpoints/**/*.ts',
						dependencies: [],
					},
					auth: {
						type: 'backend',
						path: 'apps/auth',
						port: 3002,
						entry: './src/index.ts',
						dependencies: [],
					},
					payments: {
						type: 'backend',
						path: 'apps/payments',
						port: 3003,
						routes: './src/endpoints/**/*.ts',
						dependencies: [],
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						framework: 'nextjs',
						dependencies: ['api', 'auth', 'payments'],
					},
				},
			},
			'/project',
		);

		const depEnv = getDependencyEnvVars(workspace, 'web');

		expect(depEnv).toEqual({
			API_URL: 'http://localhost:3000',
			NEXT_PUBLIC_API_URL: 'http://localhost:3000',
			AUTH_URL: 'http://localhost:3002',
			NEXT_PUBLIC_AUTH_URL: 'http://localhost:3002',
			PAYMENTS_URL: 'http://localhost:3003',
			NEXT_PUBLIC_PAYMENTS_URL: 'http://localhost:3003',
		});
	});

	it('should not rewrite NEXT_PUBLIC_ URLs via port rewriting', async () => {
		await savePortState(testDir, {
			POSTGRES_HOST_PORT: 5433,
			REDIS_HOST_PORT: 6380,
		});

		const workspace = createFullstackWorkspace();
		const depEnv = getDependencyEnvVars(workspace, 'web');

		// Simulate what gkm exec/test does: merge secrets + dep URLs, then rewrite
		const combined: Record<string, string> = {
			...createFullstackSecrets(),
			...depEnv,
		};

		const mappings = parseComposePortMappings(
			join(testDir, 'docker-compose.yml'),
		);
		const ports = await loadPortState(testDir);
		const rewritten = rewriteUrlsWithPorts(combined, {
			dockerEnv: {},
			ports,
			mappings,
		});

		// Docker service URLs rewritten
		expect(rewritten.DATABASE_URL).toContain(':5433/');
		expect(rewritten.REDIS_URL).toContain(':6380');

		// App dependency URLs NOT rewritten (3000 and 3002 are not docker ports)
		expect(rewritten.API_URL).toBe('http://localhost:3000');
		expect(rewritten.AUTH_URL).toBe('http://localhost:3002');
		expect(rewritten.NEXT_PUBLIC_API_URL).toBe('http://localhost:3000');
		expect(rewritten.NEXT_PUBLIC_AUTH_URL).toBe('http://localhost:3002');
	});
});
