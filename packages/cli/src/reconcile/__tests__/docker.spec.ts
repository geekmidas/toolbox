import { execFile } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { composeFiles, dockerCli } from '../docker';

const run = promisify(execFile);

/**
 * The `docker compose` wrapper, against a real compose project of its own: one
 * small container, started and torn down here.
 *
 * Its own project name, always. Compose reads `COMPOSE_PROJECT_NAME` from the
 * environment, and `up --remove-orphans` under a shared name would take every
 * other container in that project down as an orphan.
 */
describe('dockerCli', { timeout: 180_000 }, () => {
	let dir: string;
	let composePath: string;
	const project = `gkm-docker-spec-${Date.now()}`;

	beforeAll(async () => {
		vi.stubEnv('COMPOSE_PROJECT_NAME', project);
		dir = realpathSync(await createTempDir('gkm-docker-'));
		composePath = join(dir, 'docker-compose.constructs.yml');
		writeFileSync(
			composePath,
			`services:
  probe:
    image: busybox:1.36
    command: ['sh', '-c', 'echo probe > /tmp/marker && sleep 600']
    ports:
      - '8080'
`,
		);
	});

	afterAll(async () => {
		await run('docker', [
			'compose',
			...composeFiles(composePath),
			'down',
			'-v',
			'--timeout',
			'0',
		]).catch(() => {});
		vi.unstubAllEnvs();
		await cleanupDir(dir);
	});

	it('knows nothing is running before it starts', async () => {
		await expect(
			dockerCli.publishedPort(composePath, 'probe', 8080),
		).resolves.toBeUndefined();
		await expect(dockerCli.healthy(composePath, ['probe'])).resolves.toBe(
			false,
		);
	});

	it('starts a service, then reports its port and its health', async () => {
		await dockerCli.up(composePath, ['probe']);

		const port = await dockerCli.publishedPort(composePath, 'probe', 8080);
		expect(port).toBeGreaterThan(0);
		// No health check: running is as healthy as it gets.
		await expect(dockerCli.healthy(composePath, ['probe'])).resolves.toBe(true);
		await expect(
			dockerCli.healthy(composePath, ['probe', 'ghost']),
		).resolves.toBe(false);
	});

	it('copies a file out of a running container', async () => {
		const to = join(dir, 'out', 'marker');

		await dockerCli.copyOut(composePath, 'probe', '/tmp/marker', to);

		expect(readFileSync(to, 'utf-8')).toBe('probe\n');
	});

	it('fails to reload a container that runs no Caddy', async () => {
		await expect(dockerCli.reload(composePath, 'probe')).rejects.toThrow();
	});

	it('asks nothing when asked about no services', async () => {
		await expect(dockerCli.healthy(composePath, [])).resolves.toBe(true);
	});

	it('is not healthy with no compose file to ask', async () => {
		// Under a project name with nothing in it, as a fresh checkout has.
		vi.stubEnv('COMPOSE_PROJECT_NAME', `${project}-empty`);
		try {
			await expect(
				dockerCli.healthy(join(dir, 'missing.yml'), ['probe']),
			).resolves.toBe(false);
		} finally {
			vi.stubEnv('COMPOSE_PROJECT_NAME', project);
		}
	});
});

describe('composeFiles', () => {
	it('merges the project’s own compose file over the generated one', async () => {
		const dir = realpathSync(await createTempDir('gkm-compose-files-'));
		const generated = join(dir, 'docker-compose.constructs.yml');

		try {
			expect(composeFiles(generated)).toEqual(['-f', generated]);

			writeFileSync(join(dir, 'docker-compose.yml'), 'services: {}\n');
			expect(composeFiles(generated)).toEqual([
				'-f',
				generated,
				'-f',
				join(dir, 'docker-compose.yml'),
			]);
		} finally {
			await cleanupDir(dir);
		}
	});
});
