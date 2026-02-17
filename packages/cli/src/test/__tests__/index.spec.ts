import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	loadPortState,
	parseComposePortMappings,
	rewriteUrlsWithPorts,
	savePortState,
} from '../../dev/index';
import {
	ensureTestDatabase,
	rewriteDatabaseUrlForTests,
} from '../index';

describe('rewriteDatabaseUrlForTests', () => {
	beforeAll(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterAll(() => {
		vi.restoreAllMocks();
	});

	it('should append _test to DATABASE_URL database name', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/myapp',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/myapp_test',
		);
	});

	it('should handle URL-encoded passwords', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:p%40ssw0rd@localhost:5432/myapp',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:p%40ssw0rd@localhost:5432/myapp_test',
		);
	});

	it('should handle non-default ports', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5433/myapp',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5433/myapp_test',
		);
	});

	it('should not double-append _test if already present', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/myapp_test',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/myapp_test',
		);
	});

	it('should rewrite all keys containing DATABASE_URL', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/app',
			API_DATABASE_URL: 'postgresql://app:secret@localhost:5432/api',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/app_test',
		);
		expect(result.API_DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/api_test',
		);
	});

	it('should skip non-DATABASE_URL keys', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/app',
			REDIS_URL: 'redis://:secret@localhost:6379',
			API_KEY: 'sk-12345',
		});
		expect(result.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/app_test',
		);
		expect(result.REDIS_URL).toBe('redis://:secret@localhost:6379');
		expect(result.API_KEY).toBe('sk-12345');
	});

	it('should skip invalid URLs gracefully', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'not-a-url',
		});
		expect(result.DATABASE_URL).toBe('not-a-url');
	});

	it('should skip URLs without a database name', () => {
		const result = rewriteDatabaseUrlForTests({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/',
		});
		expect(result.DATABASE_URL).toBe('postgresql://app:secret@localhost:5432/');
	});

	it('should return empty object for empty input', () => {
		const result = rewriteDatabaseUrlForTests({});
		expect(result).toEqual({});
	});

	it('should not mutate the original object', () => {
		const original = {
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/app',
		};
		const result = rewriteDatabaseUrlForTests(original);
		expect(original.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/app',
		);
		expect(result).not.toBe(original);
	});
});

describe('ensureTestDatabase', () => {
	beforeAll(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterAll(() => {
		vi.restoreAllMocks();
	});

	it('should do nothing when DATABASE_URL is missing', async () => {
		// Should resolve without error
		await ensureTestDatabase({});
		await ensureTestDatabase({ REDIS_URL: 'redis://localhost:6379' });
	});

	it('should do nothing when database name is empty', async () => {
		await ensureTestDatabase({
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/',
		});
	});

	it('should not throw when postgres is unreachable', async () => {
		// Use a port that's almost certainly not running postgres
		await ensureTestDatabase({
			DATABASE_URL: 'postgresql://app:secret@localhost:59999/test_db',
		});
		// Should log a warning but not throw
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining('Could not ensure test database'),
		);
	});
});

describe('port rewriting + test database pipeline', () => {
	let testDir: string;

	beforeAll(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterAll(() => {
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		testDir = join(tmpdir(), `gkm-pipeline-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it('should rewrite ports then append _test to DATABASE_URL', async () => {
		// 1. Write docker-compose.yml with port mappings
		writeFileSync(
			join(testDir, 'docker-compose.yml'),
			`
services:
  postgres:
    image: postgres:17
    ports:
      - '\${POSTGRES_HOST_PORT:-5432}:5432'
  redis:
    image: redis:7
    ports:
      - '\${REDIS_HOST_PORT:-6379}:6379'
`,
		);

		// 2. Save port state (simulating gkm dev having resolved ports)
		await savePortState(testDir, {
			POSTGRES_HOST_PORT: 5433,
			REDIS_HOST_PORT: 6380,
		});

		// 3. Simulate secrets loaded from encrypted store
		let secrets: Record<string, string> = {
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/myapp',
			REDIS_URL: 'redis://:secret@localhost:6379',
			BETTER_AUTH_SECRET: 'auth-secret-123',
			BETTER_AUTH_URL: 'http://localhost:3002',
		};

		// 4. Apply port rewriting (what gkm test/exec does)
		const composePath = join(testDir, 'docker-compose.yml');
		const mappings = parseComposePortMappings(composePath);
		const ports = await loadPortState(testDir);
		secrets = rewriteUrlsWithPorts(secrets, {
			dockerEnv: {},
			ports,
			mappings,
		});

		// Ports should be rewritten
		expect(secrets.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5433/myapp',
		);
		expect(secrets.REDIS_URL).toBe('redis://:secret@localhost:6380');
		// Non-docker URLs should be untouched
		expect(secrets.BETTER_AUTH_URL).toBe('http://localhost:3002');
		expect(secrets.BETTER_AUTH_SECRET).toBe('auth-secret-123');

		// 5. Apply test database rewriting (gkm test only)
		secrets = rewriteDatabaseUrlForTests(secrets);

		// DATABASE_URL should now have both port + _test suffix
		expect(secrets.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5433/myapp_test',
		);
		// Other URLs unchanged
		expect(secrets.REDIS_URL).toBe('redis://:secret@localhost:6380');
		expect(secrets.BETTER_AUTH_URL).toBe('http://localhost:3002');
	});

	it('should handle no saved port state gracefully', async () => {
		writeFileSync(
			join(testDir, 'docker-compose.yml'),
			`
services:
  postgres:
    image: postgres:17
    ports:
      - '\${POSTGRES_HOST_PORT:-5432}:5432'
`,
		);

		// No saved port state — gkm dev hasn't run yet
		let secrets: Record<string, string> = {
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/myapp',
		};

		const composePath = join(testDir, 'docker-compose.yml');
		const mappings = parseComposePortMappings(composePath);
		const ports = await loadPortState(testDir);

		// No ports saved — rewrite should be a no-op
		if (Object.keys(ports).length > 0) {
			secrets = rewriteUrlsWithPorts(secrets, {
				dockerEnv: {},
				ports,
				mappings,
			});
		}

		// Still apply test database suffix
		secrets = rewriteDatabaseUrlForTests(secrets);

		expect(secrets.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/myapp_test',
		);
	});

	it('should handle worker template with rabbitmq ports', async () => {
		writeFileSync(
			join(testDir, 'docker-compose.yml'),
			`
services:
  postgres:
    image: postgres:17
    ports:
      - '\${POSTGRES_HOST_PORT:-5432}:5432'
  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - '\${RABBITMQ_HOST_PORT:-5672}:5672'
      - '\${RABBITMQ_MGMT_PORT:-15672}:15672'
`,
		);

		await savePortState(testDir, {
			POSTGRES_HOST_PORT: 5432,
			RABBITMQ_HOST_PORT: 5673,
			RABBITMQ_MGMT_PORT: 15672,
		});

		let secrets: Record<string, string> = {
			DATABASE_URL: 'postgresql://app:secret@localhost:5432/myapp',
			RABBITMQ_URL: 'amqp://app:secret@localhost:5672',
		};

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

		// Postgres port unchanged, but _test suffix added
		expect(secrets.DATABASE_URL).toBe(
			'postgresql://app:secret@localhost:5432/myapp_test',
		);
		// RabbitMQ port rewritten
		expect(secrets.RABBITMQ_URL).toBe('amqp://app:secret@localhost:5673');
	});
});
