import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import type { PortHolder } from '../docker';
import { composeCommand } from '../index';
import { LogsPortTaken } from '../logs';
import {
	resolvesHere,
	serveFrom,
	writeComposeApp,
} from './__helpers__/composeApp';
import { answering, fakeDocker, fakeServer } from './__helpers__/fakeDocker';

/**
 * Two stages on one server each run an OpenObserve on the server's loopback.
 * Which port each publishes is settled against the server before anything is
 * written: a named port another stack holds is refused, and the default
 * moves to a free one — or stays on the one the stack already has.
 */

const RUN_TIMEOUT = 60_000;

/** Another stage's OpenObserve on the same server, holding `5080`. */
const STAGING: PortHolder = {
	container: 'shop-staging-openobserve-1',
	project: 'shop-staging',
	service: 'openobserve',
};

describe(
	"a deployed stage's OpenObserve port",
	{ timeout: RUN_TIMEOUT },
	() => {
		let dir: string;

		beforeEach(async () => {
			vi.spyOn(console, 'log').mockImplementation(() => {});
			dir = realpathSync(await createTempDir('gkm-compose-logs-port-'));
		});
		afterEach(async () => {
			vi.restoreAllMocks();
			await cleanupDir(dir);
		});

		async function release(
			docker: Parameters<typeof fakeDocker>[0],
			write: Parameters<typeof writeComposeApp>[1] = {},
		) {
			writeComposeApp(dir, { telemetry: true, ...write });
			await serveFrom(dir);
			const fake = fakeDocker(docker);
			const result = await composeCommand(
				{ cwd: dir, stage: 'production' },
				{
					lookup: resolvesHere,
					docker: fake.docker,
					server: fakeServer(fake.calls),
					probe: answering(fake.calls),
					revision: async () => 'abc1234',
					logins: async ({ login }) => ({
						service: 'postgres',
						status: 'current',
						login,
					}),
					sql: () => ({ query: async () => [] }),
					migrate: async () => [],
					seed: async () => [],
				},
			).catch((error: unknown) => error);
			const said = vi
				.mocked(console.log)
				.mock.calls.map((call) => String(call[0]))
				.join('\n');
			return { ...fake, result, said };
		}

		/** What the stack's compose file publishes for OpenObserve. */
		const published = () =>
			parse(
				readFileSync(
					join(dir, '.gkm', 'compose', 'production', 'docker-compose.yml'),
					'utf-8',
				),
			).services.openobserve.ports;

		it('takes 5080 on a server where nothing holds it', async () => {
			const { result } = await release({});

			expect(result).not.toBeInstanceOf(Error);
			expect(published()).toEqual(['127.0.0.1:5080:5080']);
		});

		it("moves to the next free port when another stage's stack holds 5080, and prints its tunnel", async () => {
			const { result, said } = await release({
				holders: { 5080: [STAGING] },
			});

			expect(result).not.toBeInstanceOf(Error);
			expect(published()).toEqual(['127.0.0.1:5081:5080']);
			expect(said).toContain('ssh -N -L 5081:localhost:5081');
			expect(said).not.toContain('-L 5080:');
		});

		it('prints the root login it stored, unmasked, beside the tunnel', async () => {
			const { result, said } = await release({});

			expect(result).not.toBeInstanceOf(Error);
			expect(said).toContain('login: admin@shop.example.com,');
			expect(said).not.toContain('login: ***');
		});

		it('keeps the port it already publishes on a redeploy', async () => {
			const { result } = await release({
				holders: { 5080: [STAGING] },
				published: { openobserve: 5083 },
			});

			expect(result).not.toBeInstanceOf(Error);
			expect(published()).toEqual(['127.0.0.1:5083:5080']);
		});

		it('counts its own container as no clash', async () => {
			const own: PortHolder = {
				container: 'compose-app-production-openobserve-1',
				project: 'compose-app-production',
				service: 'openobserve',
			};
			const { result } = await release({ holders: { 5080: [own] } });

			expect(result).not.toBeInstanceOf(Error);
			expect(published()).toEqual(['127.0.0.1:5080:5080']);
		});

		it('refuses a port the stage named that another stack holds, before anything changes', async () => {
			const { result, ops } = await release(
				{ holders: { 5090: [STAGING] } },
				{
					deployTelemetry: {
						production: { provider: 'self-hosted', port: 5090 },
					},
				},
			);

			expect(result).toBeInstanceOf(LogsPortTaken);
			expect((result as Error).message).toMatch(
				/deploy\.telemetry\.production\.port is 5090, and 'shop-staging'/,
			);
			expect(ops()).not.toContain('up');
			expect(ops()).not.toContain('pull');
			expect(ops()).not.toContain('build');
		});
	},
);
