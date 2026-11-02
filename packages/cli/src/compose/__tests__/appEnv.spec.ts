import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { loadWorkspaceSettings } from '../../config';
import { prepareEntryCredentials } from '../../credentials/index';
import { FileSecretsStore } from '../../secrets/file';
import { keystoreProject } from '../../secrets/keystore';
import { initStageSecrets } from '../../secrets/storage';
import { composeCommand } from '../index';
import { EDGE_PORT_ENV } from '../stack';
import {
	resolvesHere,
	serveFrom,
	writeComposeApp,
} from './__helpers__/composeApp';
import { answering, fakeDocker, fakeServer } from './__helpers__/fakeDocker';

/**
 * The issue's workspace: an API, a Next site that calls it from its server
 * components, and a Worker whose cron builds links to the site and the API —
 * and a stage secret the code reads with `get('STRIPE_KEY')`, which no
 * construct declares.
 *
 * `gkm compose` and `gkm dev`/`gkm exec` must hand each app the same keys,
 * with every surface and site at its public address.
 */

const RUN_TIMEOUT = 120_000;

/** What each command adds of its own — the process, not the stage. */
const PROCESS_KEYS = new Set(['NODE_ENV', 'PORT', 'STAGE']);

let dir: string;
let home: string;
let local: Record<string, Record<string, string>>;
let composed: Record<string, Record<string, string>>;
let compose: { services: Record<string, { env_file?: unknown }> };

const write = (path: string, source: string) => {
	mkdirSync(join(dir, path, '..'), { recursive: true });
	writeFileSync(join(dir, path), source);
};

/** What `gkm exec` hands the app in `apps/<app>`, as `gkm dev` does. */
async function dev(app: string): Promise<Record<string, string>> {
	const { credentials } = await prepareEntryCredentials({
		cwd: join(dir, 'apps', app),
		scoped: true,
	});
	return credentials;
}

const keysOf = (env: Record<string, string>) =>
	Object.keys(env)
		.filter((key) => !PROCESS_KEYS.has(key))
		.sort();

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-app-env-'));
	home = realpathSync(await createTempDir('gkm-compose-app-env-home-'));
	vi.stubEnv('GKM_HOME', home);
	vi.stubEnv('COMPOSE_PROJECT_NAME', `gkm-spec-${Date.now()}`);
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});

	writeComposeApp(dir, {
		registry: 'registry.example.com/acme',
		mobile: true,
	});
	await serveFrom(dir);
	write(
		'constructs/site.ts',
		`import { StaticSite } from '@geekmidas/constructs/site';
import { api } from './api.js';
import { auth } from './auth.js';

/** A Next site whose server components call the API. */
export const web = new StaticSite('Web', {
	path: 'apps/web',
	variant: 'next',
}).dependsOn([api, auth]);
`,
	);
	write(
		'apps/api/crons/digest.ts',
		`import { api } from '../../../constructs/api.js';
import { web } from '../../../constructs/site.js';
import { worker } from '../../../constructs/worker.js';

/** Mails a link to the site, and a callback on the API. */
export const digest = worker
  .cron('rate(1 day)')
  .dependsOn([web, api])
  .handle(async ({ services }) => [services.web, services.api]);
`,
	);
	await new FileSecretsStore(
		dir,
		keystoreProject(await loadWorkspaceSettings(dir), home),
	).write('development', {
		...initStageSecrets('development'),
		custom: { STRIPE_KEY: 'sk_test_parity' },
	});

	// What gkm exec hands each app — as `next dev` and the API's `gkm dev`
	// get it — before the stack is composed.
	local = {
		api: await dev('api'),
		auth: await dev('auth'),
		web: await dev('web'),
	};
	// The stack's edge on the port this machine's dev edge is on: the one
	// input the two commands are each handed their own of.
	vi.stubEnv(EDGE_PORT_ENV.https, new URL(local.web!.WEB_URL!).port || '443');

	const fake = fakeDocker();
	await composeCommand(
		{ cwd: dir, stage: 'development' },
		{
			lookup: resolvesHere,
			docker: fake.docker,
			server: fakeServer([]),
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
	);

	const out = join(dir, '.gkm', 'compose', 'development');
	composed = Object.fromEntries(
		['api', 'auth', 'jobs', 'web'].map((name) => [
			name,
			parse(readFileSync(join(out, `${name}.env`), 'utf-8')),
		]),
	);
	compose = parseYaml(readFileSync(join(out, 'docker-compose.yml'), 'utf-8'));
}, RUN_TIMEOUT);

afterAll(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await cleanupDir(dir);
	await cleanupDir(home);
});

describe(
	"an app's environment, under gkm compose and gkm dev",
	{
		timeout: RUN_TIMEOUT,
	},
	() => {
		it('gives a Next site a runtime env file: its edges, at their public addresses', async () => {
			const web = composed.web!;
			const own = local.web!;

			expect(compose.services.web?.env_file).toEqual([
				{ path: './web.env', format: 'raw' },
			]);
			// The same keys gkm exec hands `next dev`.
			expect(keysOf(web)).toEqual(keysOf(own));
			// Its server components call the API through the edge, as a browser.
			for (const key of ['API_URL', 'AUTH_URL', 'WEB_URL']) {
				expect(web[key]).toMatch(/^https:\/\//);
				expect(web[key]).toBe(own[key]);
			}
			// And it reads the stage's own secret on its server.
			expect(web.STRIPE_KEY).toBe('sk_test_parity');
			// Never the database it has no edge to.
			expect(web).not.toHaveProperty('DATABASE_URL');
		});

		it("gives the API and the worker it hosts the keys the API's dev process has", async () => {
			const api = composed.api!;
			const jobs = composed.jobs!;
			const own = local.api!;

			// Under gkm dev the API's process runs the worker's cron too; the stack
			// runs each in a container of its own. Together they are the same keys.
			expect([...new Set([...keysOf(api), ...keysOf(jobs)])].sort()).toEqual(
				keysOf(own),
			);
			// Every surface and site at its public address, in both.
			for (const key of ['API_URL', 'AUTH_URL']) {
				expect(api[key]).toMatch(/^https:\/\//);
				expect(api[key]).toBe(own[key]);
			}
			expect(api.STRIPE_KEY).toBe('sk_test_parity');
		});

		it('gives the API the identity of each client that calls it, as gkm dev does', () => {
			const api = composed.api!;
			const own = local.api!;

			// `MobileApp('App').dependsOn([api])`: the API links and redirects
			// back into the app (an OAuth callback's `<scheme>://…`).
			expect(api.APP_SCHEME).toBe('compose-app');
			expect(own.APP_SCHEME).toBe(api.APP_SCHEME);
			// `StaticSite('Web').dependsOn([api])`: and back to the site.
			expect(api.WEB_URL).toMatch(/^https:\/\//);
			expect(own.WEB_URL).toBe(api.WEB_URL);
			// Not only folded into the origins it trusts.
			expect(api.API_TRUSTED_ORIGINS).toContain('compose-app://');
		});

		it('gives the auth server the clients that call it, and not the API', () => {
			const auth = composed.auth!;

			expect(auth.APP_SCHEME).toBe('compose-app');
			expect(auth.WEB_URL).toBe(composed.web!.WEB_URL);
			expect(auth).not.toHaveProperty('API_URL');
		});

		it("hands the worker's cron the site's and the API's public URLs it depends on", () => {
			const jobs = composed.jobs!;

			expect(jobs.WEB_URL).toBe(composed.web!.WEB_URL);
			expect(jobs.API_URL).toBe(composed.api!.API_URL);
			expect(jobs.STRIPE_KEY).toBe('sk_test_parity');
		});

		it('keeps the auth server to its own keys, the stage secret aside', async () => {
			const auth = composed.auth!;
			const own = local.auth!;

			expect(keysOf(auth)).toEqual(keysOf(own));
			expect(auth.AUTH_URL).toBe(own.AUTH_URL);
			expect(auth.STRIPE_KEY).toBe('sk_test_parity');
			// No other app holds its signing secret.
			expect(composed.api).not.toHaveProperty('AUTH_SECRET');
			expect(composed.web).not.toHaveProperty('AUTH_SECRET');
		});
	},
);
