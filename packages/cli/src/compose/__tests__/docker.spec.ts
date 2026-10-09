/**
 * The Docker wiring itself, against this machine's engine and the
 * containers the suite already runs (`docker-compose.yml`, project
 * `geekmidas-toolbox-test`): finding a service's container by its labels, a
 * command run in it, and a one-off container that reads its stdin.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { POSTGRES_PORT } from '../../../../testkit/test/ports';
import {
	dockerCompose,
	engineEnv,
	projectNetwork,
	type StackRef,
} from '../docker';

/** The suite's own compose project, which runs the test Postgres. */
const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const SUITE: StackRef = {
	project: 'geekmidas-toolbox-test',
	file: join(ROOT, 'docker-compose.yml'),
	cwd: ROOT,
	output: 'ignore',
};

/** The test Postgres's image: on this machine, since it is running. */
const IMAGE = 'postgres:18';

const NETWORK = `gkm-docker-spec-${Date.now().toString(36)}`;

afterAll(() => {
	spawnSync('docker', ['network', 'rm', NETWORK]);
});

describe('the engine a command runs on', () => {
	it("is a server's when the stack names one, and this machine's otherwise", () => {
		expect(engineEnv({})).toBeUndefined();
		expect(engineEnv({ host: 'ssh://deploy@203.0.113.10' })).toMatchObject({
			DOCKER_HOST: 'ssh://deploy@203.0.113.10',
		});
		expect(engineEnv({}, { DOCKER_BUILDKIT: '1' })).toMatchObject({
			DOCKER_BUILDKIT: '1',
		});
		expect(projectNetwork('shop-production')).toBe('shop-production_default');
	});
});

describe("a service's container", () => {
	it('is found by its compose labels, with the image it runs', async () => {
		const found = await dockerCompose.container({}, SUITE.project, 'postgres');
		expect(found?.id).toMatch(/^[0-9a-f]{12}$/);
		expect(found?.image).toBe(IMAGE);
		expect(
			await dockerCompose.container({}, SUITE.project, 'no-such-service'),
		).toBeUndefined();
	});

	it('runs a command, its input on stdin, and says what it printed', async () => {
		const result = await dockerCompose.exec(
			SUITE,
			'postgres',
			['sh', '-c', 'cat; echo; echo done >&2; exit 4'],
			'hello',
		);
		expect(result).toEqual({ code: 4, stdout: 'hello\n', stderr: 'done\n' });

		expect(
			await dockerCompose.exec(SUITE, 'no-such-service', ['true']),
		).toEqual({
			code: null,
			stdout: '',
			stderr: 'no-such-service is not running',
		});
	});

	it('is among those publishing the port it publishes', async () => {
		const holders = await dockerCompose.publishers({}, POSTGRES_PORT);
		expect(holders).toContainEqual({
			container: expect.any(String),
			project: SUITE.project,
			service: 'postgres',
		});
	});

	it("resolves to the image's id or digest", async () => {
		expect(await dockerCompose.digest({}, IMAGE)).toMatch(/^sha256:/);
		expect(
			await dockerCompose.digest({}, 'gkm-never-built/nothing:none'),
		).toBeUndefined();
	});
});

describe("the suite's own stack, read through its compose file", () => {
	it('says the host port a service publishes, and refuses one it does not', async () => {
		expect(await dockerCompose.port(SUITE, 'postgres', 5432)).toBe(
			POSTGRES_PORT,
		);
		await expect(dockerCompose.port(SUITE, 'postgres', 5999)).rejects.toThrow();
	});

	it("says a service's health, and nothing for one that is not there", async () => {
		expect(await dockerCompose.health(SUITE, 'postgres')).toBe('healthy');
		expect(
			await dockerCompose.health(
				{ ...SUITE, project: 'gkm-no-such-project' },
				'postgres',
			),
		).toBeUndefined();
	});

	it('copies a file out of a running service', async () => {
		const to = join(
			mkdtempSync(join(tmpdir(), 'gkm-docker-')),
			'out',
			'version',
		);
		await dockerCompose.copyOut(
			SUITE,
			'postgres',
			'/usr/local/bin/docker-entrypoint.sh',
			to,
		);
		expect(readFileSync(to, 'utf-8')).toMatch(/^#!/);
	});

	it('cannot ask a registry that is not there about an image, and says so', async () => {
		const answer = await dockerCompose.lookup('localhost:1/gkm/nothing:none');
		expect(answer).toMatchObject({
			ref: 'localhost:1/gkm/nothing:none',
			status: 'unreachable',
		});
	});
});

describe('a one-off container', () => {
	it('reads a stream on stdin, with its environment passed by name, and is gone after', async () => {
		await dockerCompose.ensureNetwork({}, NETWORK);
		// A second ask finds it.
		await dockerCompose.ensureNetwork({}, NETWORK);

		const code = await dockerCompose.runOnce(
			{},
			{
				image: IMAGE,
				network: NETWORK,
				command: [
					'sh',
					'-c',
					'read line; [ "$line" = "streamed" ] && [ "$GKM_SPEC" = "secret value" ]',
				],
				env: { GKM_SPEC: 'secret value' },
				stdin: Readable.from([Buffer.from('streamed\n')]),
				output: 'ignore',
			},
		);
		expect(code).toBe(0);

		expect(
			await dockerCompose.runOnce(
				{},
				{
					image: IMAGE,
					network: NETWORK,
					command: ['sh', '-c', 'exit 3'],
					output: 'ignore',
				},
			),
		).toBe(3);

		const left = spawnSync(
			'docker',
			['ps', '-aq', '--filter', `network=${NETWORK}`],
			{ encoding: 'utf-8' },
		);
		expect(left.stdout.trim()).toBe('');
	}, 60_000);
});
