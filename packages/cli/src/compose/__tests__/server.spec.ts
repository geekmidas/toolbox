import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { engineEnv } from '../docker';
import { composeCommand } from '../index';
import {
	ComposeServerMissing,
	ComposeServerUnreachable,
	composeServer,
	dockerHost,
} from '../server';
import {
	resolvesHere,
	SERVER_IPV4,
	serveFrom,
	writeComposeApp,
} from './__helpers__/composeApp';
import {
	answering,
	type Call,
	fakeDocker,
	fakeServer,
	TUNNEL_PORT,
} from './__helpers__/fakeDocker';

/**
 * A deployed stage runs on its server's Docker engine, over SSH, and never on
 * this machine's: `DOCKER_HOST` is the server's for every call the deploy
 * makes, nothing the stack runs is mounted from a path here, the env files
 * are read here, and the databases are reached through a tunnel.
 */

const RUN_TIMEOUT = 60_000;
const HOST = `ssh://deploy@${SERVER_IPV4}`;

describe('composeServer', () => {
	it("is the stage's login, on its GKM_SERVER_IPV4, on port 22", () => {
		expect(
			composeServer({
				stage: 'production',
				local: false,
				config: { production: { user: 'deploy' } },
				custom: { GKM_SERVER_IPV4: SERVER_IPV4 },
			}),
		).toEqual({ user: 'deploy', host: SERVER_IPV4, port: 22 });
	});

	it('takes a host and port from the config over the secret', () => {
		const server = composeServer({
			stage: 'staging',
			local: false,
			config: {
				staging: { user: 'ops', host: 'staging.example.com', port: 2222 },
			},
			custom: { GKM_SERVER_IPV4: SERVER_IPV4 },
		})!;
		expect(server).toEqual({
			user: 'ops',
			host: 'staging.example.com',
			port: 2222,
		});
		expect(dockerHost(server)).toBe('ssh://ops@staging.example.com:2222');
	});

	it('is nothing for the local stage, which runs on this machine', () => {
		expect(
			composeServer({
				stage: 'development',
				local: true,
				config: undefined,
				custom: undefined,
			}),
		).toBeUndefined();
	});

	it('refuses a deployed stage with no login, or no host', () => {
		const resolve =
			(
				config: Record<string, { user: string }>,
				custom: Record<string, string>,
			) =>
			() =>
				composeServer({ stage: 'production', local: false, config, custom });
		expect(resolve({}, { GKM_SERVER_IPV4: SERVER_IPV4 })).toThrow(
			ComposeServerMissing,
		);
		expect(resolve({ production: { user: 'deploy' } }, {})).toThrow(
			ComposeServerMissing,
		);
	});
});

describe('engineEnv', () => {
	it("sets DOCKER_HOST for a server's engine, and leaves this machine's alone", () => {
		expect(engineEnv({ host: HOST })?.DOCKER_HOST).toBe(HOST);
		expect(engineEnv({})).toBeUndefined();
	});
});

describe('a deployed stage on its server', { timeout: RUN_TIMEOUT }, () => {
	let dir: string;

	beforeEach(async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		dir = realpathSync(await createTempDir('gkm-compose-server-'));
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	/** A release of `stage`, everything outside the process recorded. */
	async function release(
		stage: string,
		options: { unreachable?: Error; dryRun?: boolean } = {},
	) {
		const fake = fakeDocker();
		const migrations: { env: Record<string, string | undefined> }[] = [];
		const result = await composeCommand(
			{ cwd: dir, stage, ...(options.dryRun ? { dryRun: true } : {}) },
			{
				lookup: resolvesHere,
				docker: fake.docker,
				server: fakeServer(fake.calls, options),
				probe: answering(fake.calls),
				revision: async () => 'abc1234',
				logins: async ({ login, port }) => {
					fake.calls.push({ op: 'login', args: port });
					return { service: 'postgres', status: 'current', login };
				},
				sql: (port) => ({
					async query() {
						fake.calls.push({ op: 'sql', args: port });
						return [];
					},
				}),
				migrate: async (options) => {
					fake.calls.push({ op: 'migrate' });
					migrations.push(options);
					return [];
				},
				seed: async () => {
					fake.calls.push({ op: 'seed' });
					return [];
				},
			},
		).catch((error: unknown) => error);
		const said = vi
			.mocked(console.log)
			.mock.calls.map((call) => String(call[0]))
			.join('\n');
		return { ...fake, result, migrations, said };
	}

	/** Every docker call made against an engine, and which one. */
	const dockerCalls = (calls: Call[]) =>
		calls.filter((call) =>
			['build', 'pull', 'up', 'down', 'port', 'health', 'exec'].includes(
				call.op,
			),
		);

	it("drives the server's engine for every docker call, and the local stage's own", async () => {
		writeComposeApp(dir);
		await serveFrom(dir);

		const deployed = await release('production');
		expect(deployed.result).not.toBeInstanceOf(Error);
		const remote = dockerCalls(deployed.calls);
		expect(remote.length).toBeGreaterThan(0);
		for (const call of remote) expect(call.host).toBe(HOST);
		// SSH answered before anything else was done there.
		expect(deployed.ops().indexOf('ssh')).toBeLessThan(
			deployed.ops().indexOf('up'),
		);
		expect(deployed.said).toContain(
			`→ deploy@${SERVER_IPV4} (docker over ssh)`,
		);

		const local = await release('development');
		expect(local.result).not.toBeInstanceOf(Error);
		const here = dockerCalls(local.calls);
		expect(here.length).toBeGreaterThan(0);
		for (const call of here) expect(call.host).toBeUndefined();
		expect(local.ops()).not.toContain('ssh');
		expect(local.ops()).not.toContain('tunnel');
	});

	it('mounts nothing from this machine, and reads the env files here', async () => {
		writeComposeApp(dir);
		await serveFrom(dir);

		await release('production');

		const stackDir = join(dir, '.gkm', 'compose', 'production');
		const compose = parse(
			readFileSync(join(stackDir, 'docker-compose.yml'), 'utf-8'),
		);
		for (const [name, service] of Object.entries(
			compose.services as Record<string, { volumes?: string[] }>,
		)) {
			for (const volume of service.volumes ?? []) {
				// A named volume, on the server: never `./x`, `/x` or `~/x`.
				expect(volume, name).toMatch(/^[a-z][\w-]*:\//);
			}
		}
		// Caddy's files are inline.
		expect(compose.services.caddy.configs).toEqual([
			{ source: 'caddyfile', target: '/etc/caddy/Caddyfile' },
		]);
		expect(compose.configs.caddyfile.content).toBe(
			readFileSync(join(stackDir, 'Caddyfile'), 'utf-8'),
		);
		// Each backend's env file is beside the compose file, here: compose
		// reads it on this machine and sends the values with the container.
		expect(compose.services.api.env_file).toEqual([
			{ path: './api.env', format: 'raw' },
		]);
		expect(readFileSync(join(stackDir, 'api.env'), 'utf-8')).toContain(
			'DATABASE_URL=',
		);
	});

	it("migrates through an SSH tunnel to the server's loopback, and closes it", async () => {
		writeComposeApp(dir);
		await serveFrom(dir);

		const { calls, migrations } = await release('production');

		const ops = calls.map((call) => call.op);
		const opened = ops.indexOf('tunnel');
		expect(calls[opened]).toEqual({
			op: 'tunnel',
			args: [`deploy@${SERVER_IPV4}`, 55432],
		});
		// Signed in, provisioned, migrated and seeded through it, then closed —
		// before any app starts.
		expect(calls.find((call) => call.op === 'login')?.args).toBe(TUNNEL_PORT);
		expect(calls.find((call) => call.op === 'sql')?.args).toBe(TUNNEL_PORT);
		const closed = ops.indexOf('tunnel-closed');
		expect(ops.indexOf('migrate')).toBeGreaterThan(opened);
		expect(ops.indexOf('seed')).toBeLessThan(closed);
		expect(closed).toBeLessThan(ops.lastIndexOf('up'));
		expect(migrations[0]!.env.DATABASE_URL).toContain(
			`localhost:${TUNNEL_PORT}/`,
		);
	});

	it('changes nothing when SSH to the server fails', async () => {
		writeComposeApp(dir);
		await serveFrom(dir);
		const unreachable = new ComposeServerUnreachable(
			`deploy@${SERVER_IPV4}`,
			'Permission denied (publickey).',
		);

		const { result, ops } = await release('production', { unreachable });

		expect(result).toBe(unreachable);
		expect((result as Error).message).toContain(
			'ssh said: Permission denied (publickey).',
		);
		expect(ops()).not.toContain('up');
		expect(ops()).not.toContain('pull');
		expect(ops()).not.toContain('build');
	});

	it('says where a dry run would deploy, and connects to nothing', async () => {
		writeComposeApp(dir);
		await serveFrom(dir);

		const { said, ops } = await release('production', { dryRun: true });

		expect(said).toContain(`→ deploy@${SERVER_IPV4} (docker over ssh)`);
		expect(ops()).not.toContain('ssh');
		expect(ops()).not.toContain('tunnel');
		expect(ops()).not.toContain('up');
	});

	it('refuses a deployed stage with no server, before anything is done', async () => {
		writeComposeApp(dir, { server: false });
		await serveFrom(dir);

		const { result, ops } = await release('production');

		expect(result).toBeInstanceOf(ComposeServerMissing);
		expect(result).toMatchObject({ stage: 'production', missing: 'config' });
		expect((result as Error).message).toContain(
			"deploy: { compose: { server: { production: { user: 'deploy' } } } }",
		);
		expect(ops().filter((op) => op !== 'lookup')).toEqual([]);
	});
});
