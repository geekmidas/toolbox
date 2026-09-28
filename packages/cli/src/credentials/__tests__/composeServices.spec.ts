import { execFile } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { startComposeServices, startWorkspaceServices } from '../index';

const run = promisify(execFile);

/**
 * A project that writes its own `docker-compose.yml` still gets its services
 * started by `gkm dev` and `gkm test`. These run a real one: a single small
 * container, under a project name of its own so nothing else is touched.
 */
describe('starting hand-written compose services', { timeout: 180_000 }, () => {
	let dir: string;
	let log: MockInstance;
	let error: MockInstance;
	const project = `gkm-compose-services-${Date.now()}`;

	const compose = (services: string) =>
		writeFileSync(join(dir, 'docker-compose.yml'), `services:\n${services}`);
	const running = async () => {
		const { stdout } = await run(
			'docker',
			['compose', 'ps', '--format', '{{.Service}}'],
			{ cwd: dir, env: { ...process.env, COMPOSE_PROJECT_NAME: project } },
		);
		return stdout.trim().split('\n').filter(Boolean);
	};

	beforeAll(async () => {
		vi.stubEnv('COMPOSE_PROJECT_NAME', project);
		dir = realpathSync(await createTempDir('gkm-compose-services-'));
	});

	afterEach(() => vi.restoreAllMocks());

	afterAll(async () => {
		// With orphans: the last case rewrote the file, and a container started
		// from an earlier version of it is still this project's.
		await run(
			'docker',
			['compose', 'down', '-v', '--remove-orphans', '--timeout', '0'],
			{
				cwd: dir,
				env: { ...process.env, COMPOSE_PROJECT_NAME: project },
			},
		).catch(() => {});
		vi.unstubAllEnvs();
		await cleanupDir(dir);
	});

	const quiet = () => {
		log = vi.spyOn(console, 'log').mockImplementation(() => {});
		error = vi.spyOn(console, 'error').mockImplementation(() => {});
	};

	it('does nothing without a compose file, or with an empty one', async () => {
		quiet();
		await startComposeServices(dir);
		await startWorkspaceServices({ root: dir, apps: {} });

		compose('  {}\n');
		await startComposeServices(dir);

		expect(log).not.toHaveBeenCalled();
	});

	it('leaves the services turbo runs to turbo', async () => {
		quiet();
		compose(`  api:\n    image: busybox:1.36\n    command: ['sleep', '600']\n`);

		await startWorkspaceServices({ root: dir, apps: { api: {} } });

		expect(log).not.toHaveBeenCalled();
		expect(await running()).toEqual([]);
	});

	it('starts every service of a single app, with the secrets for interpolation', async () => {
		quiet();
		compose(`  probe:
    image: busybox:1.36
    command: ['sh', '-c', 'echo "$$PROBE_SECRET" > /tmp/secret && sleep 600']
    environment:
      - PROBE_SECRET=\${PROBE_SECRET}
`);

		await startComposeServices(dir, {}, { PROBE_SECRET: 'from-secrets' });

		expect(await running()).toEqual(['probe']);
		expect(log.mock.calls.flat().join('\n')).toContain('Services started');
		const { stdout } = await run(
			'docker',
			['compose', 'exec', '-T', 'probe', 'printenv', 'PROBE_SECRET'],
			{ cwd: dir, env: { ...process.env, COMPOSE_PROJECT_NAME: project } },
		);
		expect(stdout.trim()).toBe('from-secrets');
	});

	it('starts a workspace’s infrastructure but not its apps', async () => {
		quiet();
		compose(`  probe:
    image: busybox:1.36
    command: ['sleep', '600']
  web:
    image: busybox:1.36
    command: ['sleep', '600']
`);

		await startWorkspaceServices({ root: dir, apps: { web: {} } });

		expect(await running()).toEqual(['probe']);
	});

	it('reports and rethrows when compose cannot start them', async () => {
		quiet();
		compose(`  broken:\n    image: gkm-no-such-image-anywhere:never\n`);

		await expect(startComposeServices(dir)).rejects.toThrow();
		expect(error.mock.calls.flat().join('\n')).toContain(
			'Failed to start services',
		);

		await expect(
			startWorkspaceServices({ root: dir, apps: {} }),
		).rejects.toThrow();
	});
});
