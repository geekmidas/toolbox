import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe as baseDescribe,
	expect,
	it,
} from 'vitest';
import { prepareEntryCredentials } from '../index';
import {
	createDockerCompose,
	createPackageJson,
	createSecretsFile,
} from './helpers';

// Skip port-probing tests in CI due to flaky port binding issues
const describe = process.env.CI ? baseDescribe.skip : baseDescribe;

// Track servers to clean up after each test
const activeServers: ReturnType<typeof createServer>[] = [];

function occupyPort(
	port: number,
): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', (err) => reject(err));
		server.once('listening', () => {
			activeServers.push(server);
			const actualPort = (server.address() as AddressInfo).port;
			resolve({ server, port: actualPort });
		});
		server.listen(port);
	});
}

describe('full mode Docker port resolution', () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(
			tmpdir(),
			`gkm-ports-full-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(testDir, { recursive: true });
		createPackageJson('my-app', testDir);
		createDockerCompose(
			[
				{
					name: 'postgres',
					envVar: 'POSTGRES_HOST_PORT',
					defaultPort: 5432,
					containerPort: 5432,
				},
			],
			testDir,
		);
		createSecretsFile(
			'development',
			{
				DATABASE_URL: 'postgresql://user:pass@postgres:5432/mydb',
				POSTGRES_HOST: 'postgres',
				POSTGRES_PORT: '5432',
			},
			testDir,
		);
	});

	afterEach(async () => {
		await Promise.all(
			activeServers.map(
				(server) =>
					new Promise<void>((resolve) => {
						server.close(() => resolve());
					}),
			),
		);
		activeServers.length = 0;
		await new Promise((resolve) => setTimeout(resolve, 50));

		if (existsSync(testDir)) {
			const { rm } = await import('node:fs/promises');
			await rm(testDir, { recursive: true, force: true });
		}
	});

	it('should resolve ports and rewrite URLs', async () => {
		const result = await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'full',
		});

		expect(result.credentials.POSTGRES_HOST).toBe('localhost');
		expect(result.credentials.DATABASE_URL).toContain('@localhost:');
		expect(result.credentials.PORT).toBe('3000');
	});

	it('should write ports.json after full resolution', async () => {
		await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'full',
		});

		const portsPath = join(testDir, '.gkm', 'ports.json');
		expect(existsSync(portsPath)).toBe(true);

		const ports = JSON.parse(readFileSync(portsPath, 'utf-8'));
		expect(ports.POSTGRES_HOST_PORT).toBeDefined();
		expect(typeof ports.POSTGRES_HOST_PORT).toBe('number');
	});

	it('should pick a different port when default is occupied', async () => {
		// Occupy port 5432 (may already be in use by a real postgres)
		let occupiedPort: number;
		try {
			const result = await occupyPort(5432);
			occupiedPort = result.port;
		} catch {
			// Port 5432 already occupied (e.g., by a running postgres)
			occupiedPort = 5432;
		}
		expect(occupiedPort).toBe(5432);

		const result = await prepareEntryCredentials({
			cwd: testDir,
			resolveDockerPorts: 'full',
		});

		const portsPath = join(testDir, '.gkm', 'ports.json');
		const ports = JSON.parse(readFileSync(portsPath, 'utf-8'));
		expect(ports.POSTGRES_HOST_PORT).not.toBe(5432);

		expect(result.credentials.DATABASE_URL).toContain(
			`:${ports.POSTGRES_HOST_PORT}`,
		);
		expect(result.credentials.POSTGRES_PORT).toBe(
			String(ports.POSTGRES_HOST_PORT),
		);
	});
});
