import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { loadWorkspaceConfig } from '../../../config';
import { discover } from '../../../reconcile/discover';
import { constructGlobs } from '../../../reconcile/workspace';
import type { NormalizedWorkspace } from '../../../workspace/types';

const FIXTURE = join(import.meta.dirname, '..', '__fixtures__', 'compose-app');

export interface ComposeAppOptions {
	/** The workspace name — what the compose project and image names derive from. */
	name?: string;
	/** The deployed stage's base domain. */
	domain?: string;
	/** Where images are pushed and pulled. */
	registry?: string;
	/**
	 * Give the API, the auth server and the worker a `Telemetry` construct.
	 */
	telemetry?: boolean;
	/** `deploy.telemetry`, as it is written in the config. */
	deployTelemetry?: Record<string, unknown>;
	/** `deploy.objects`, as it is written in the config. */
	deployObjects?: Record<string, unknown>;
	/** `deploy.backups`, as it is written in the config. */
	deployBackups?: Record<string, unknown>;
	/** `deploy.sitePassword`, as it is written in the config. */
	sitePassword?: Record<string, unknown>;
	/** The rest of `deploy.compose` — `proxy`, `tls` — as written. */
	compose?: Record<string, unknown>;
	/** The deployed stages, `['production']` when absent. */
	deployed?: readonly string[];
	/** The protected stages, none when absent. */
	protected?: readonly string[];
	/** Each deployed stage's domain, in place of `domain`. */
	domains?: Record<string, string>;
	/** `dns`, as it is written in the config. */
	dns?: Record<string, unknown>;
	/** `deploy.default` — `dokploy` when absent. */
	target?: string;
	/** `state`, as it is written in the config. */
	state?: Record<string, unknown>;
	/** `secrets`, as it is written in the config. */
	secrets?: Record<string, unknown>;
	/**
	 * `deploy.compose.server`: every deployed stage's login, `deploy` on the
	 * stage's GKM_SERVER_IPV4, when absent — `false` for none.
	 */
	server?: Record<string, unknown> | false;
	/**
	 * A second RestApi, `Reviewer` in `apps/reviewer`, whose one globbed
	 * endpoint reads only the auth tenant — and a cron on the worker, which
	 * reads a credential nothing else does.
	 */
	reviewer?: boolean;
	/**
	 * A `MobileApp`, `App` in `apps/app`, that calls the API and the auth
	 * server — with each stage's `stages` setting, where given.
	 */
	mobile?: boolean | { stages: Record<string, unknown> };
	/**
	 * A `WebSocketApi`, `Realtime` in `apps/realtime` on three replicas, with
	 * one route — and an API endpoint that sends to its sockets.
	 */
	realtime?: boolean;
}

/**
 * A workspace written the way one is now: a RestApi authenticated by a
 * BetterAuth server in its own container, a database with the auth tenant's
 * migration committed, a Vite site that calls both — the API through the
 * client gkm generates from its endpoints — and a Worker whose queue
 * consumer writes the notes the API sends it.
 *
 * The code is the fixture; what a project keeps beside it — package files,
 * the workspace config — is written here, so the fixture holds nothing that
 * resolves only once copied.
 */
export function writeComposeApp(
	dir: string,
	options: ComposeAppOptions = {},
): void {
	const name = options.name ?? 'compose-app';
	cpSync(FIXTURE, dir, { recursive: true });
	const deployed = options.deployed ?? ['production'];
	const server =
		options.server === false
			? undefined
			: (options.server ??
				Object.fromEntries(
					deployed.map((stage) => [stage, { user: 'deploy' }]),
				));
	const compose =
		options.compose || server
			? { ...options.compose, ...(server ? { server } : {}) }
			: undefined;
	if (options.telemetry) {
		writeFileSync(
			join(dir, 'constructs', 'telemetry.ts'),
			`import { Telemetry } from '@geekmidas/constructs/telemetry';

/** What the API, the auth server and the worker emit. */
export const telemetry = new Telemetry('Telemetry', {
  attributes: { 'service.namespace': ${JSON.stringify(name)} },
});
`,
		);
	}

	const json = (path: string, value: unknown) =>
		writeFileSync(join(dir, path), `${JSON.stringify(value, null, 2)}\n`);

	if (options.reviewer) writeReviewer(dir, name);
	if (options.realtime) writeRealtime(dir, name);
	if (options.mobile) {
		const stages =
			typeof options.mobile === 'object'
				? `, stages: ${JSON.stringify(options.mobile.stages)}`
				: '';
		writeFileSync(
			join(dir, 'constructs', 'mobile.ts'),
			`import { MobileApp } from '@geekmidas/constructs/mobile-app';
import { api } from './api.js';
import { auth } from './auth.js';

/** The phone app: built by EAS with the stage's API and auth URLs. */
export const app = new MobileApp('App', { path: 'apps/app'${stages} }).dependsOn([
  api,
  auth,
]);
`,
		);
	}

	json('package.json', {
		name,
		private: true,
		type: 'module',
		packageManager: 'pnpm@10.13.1',
		// The client the stack's Redis is reached with.
		dependencies: { ioredis: '~6.0.0' },
		// What `gkm init` scaffolds for a fullstack workspace.
		scripts: { build: 'gkm build' },
	});
	writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
	json('turbo.json', {
		$schema: 'https://turborepo.com/schema.json',
		tasks: { build: { outputs: ['dist/**'] } },
	});

	for (const app of options.mobile ? ['api', 'auth', 'app'] : ['api', 'auth']) {
		mkdirSync(join(dir, 'apps', app), { recursive: true });
		json(`apps/${app}/package.json`, {
			name: `@${name}/${app}`,
			private: true,
			type: 'module',
		});
	}
	json('apps/web/package.json', {
		name: `@${name}/web`,
		private: true,
		type: 'module',
		// Through `gkm exec`, as a site's scripts are: in its image that injects
		// the build args, and nothing from a secrets store.
		scripts: { build: 'gkm exec -- vite build' },
		devDependencies: { vite: '~8.3.1' },
	});

	writeFileSync(
		join(dir, 'gkm.config.ts'),
		`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: ${JSON.stringify(name)},
  stages: { local: 'development', deployed: ${JSON.stringify(deployed)}${options.protected ? `, protected: ${JSON.stringify(options.protected)}` : ''} },
  constructs: [
    './constructs/**/*.ts',
    './apps/*/endpoints/**/*.ts',
    './apps/*/queues/**/*.ts',
    './apps/*/crons/**/*.ts',
  ],
  domains: ${JSON.stringify(options.domains ?? { production: options.domain ?? 'shop.example.com' })},
  ${options.dns ? `dns: ${JSON.stringify(options.dns)},` : ''}
  ${options.state ? `state: ${JSON.stringify(options.state)},` : ''}
  ${options.secrets ? `secrets: ${JSON.stringify(options.secrets)},` : ''}
  deploy: {
    default: ${JSON.stringify(options.target ?? 'dokploy')},
    ${options.registry ? `registry: ${JSON.stringify(options.registry)},` : ''}
    ${compose ? `compose: ${JSON.stringify(compose)},` : ''}
    ${options.deployTelemetry ? `telemetry: ${JSON.stringify(options.deployTelemetry)},` : ''}
    ${options.deployObjects ? `objects: ${JSON.stringify(options.deployObjects)},` : ''}
    ${options.deployBackups ? `backups: ${JSON.stringify(options.deployBackups)},` : ''}
    ${options.sitePassword ? `sitePassword: ${JSON.stringify(options.sitePassword)},` : ''}
  },
});
`,
	);
}

/** The WebSocket surface — see `ComposeAppOptions.realtime`. */
function writeRealtime(dir: string, name: string): void {
	const write = (path: string, source: string) => {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), source);
	};
	write(
		'constructs/realtime.ts',
		`import { WebSocketApi } from '@geekmidas/constructs/websocket-api';
import { logger } from './logger.js';

/** Long-lived connections, on three processes. */
export const realtime = new WebSocketApi('Realtime', {
  path: 'apps/realtime',
  replicas: 3,
  logger,
});
`,
	);
	write(
		'apps/realtime/endpoints/echo.ts',
		`import { z } from 'zod';
import { realtime } from '../../../constructs/realtime.js';

export const echo = realtime
  .route('echo')
  .body(z.object({ text: z.string() }))
  .handle(({ body }) => body);
`,
	);
	write(
		'apps/api/endpoints/notify.ts',
		`import { z } from 'zod';
import { api } from '../../../constructs/api.js';
import { realtime } from '../../../constructs/realtime.js';

/** Sends to a socket the realtime surface holds. */
export const notify = api
  .post('/notify')
  .dependsOn([realtime])
  .body(z.object({ to: z.string() }))
  .handle(async ({ body, services }) => {
    await services.realtime.send(body.to, { hello: true });
  });
`,
	);
	write(
		'apps/realtime/package.json',
		`${JSON.stringify({ name: `@${name}/realtime`, private: true, type: 'module' }, null, 2)}\n`,
	);
}

/**
 * The second surface and the worker's cron — see `ComposeAppOptions.reviewer`.
 */
function writeReviewer(dir: string, name: string): void {
	const write = (path: string, source: string) => {
		mkdirSync(join(dir, path, '..'), { recursive: true });
		writeFileSync(join(dir, path), source);
	};
	write(
		'constructs/reviewer.ts',
		`import { RestApi } from '@geekmidas/constructs/rest-api';
import { logger } from './logger.js';

/** A small password-protected page: its own surface, its own container. */
export const reviewer = new RestApi('Reviewer', {
  path: 'apps/reviewer',
  defaultAuthorizer: 'none',
  logger,
});
`,
	);
	write(
		'constructs/push.ts',
		`import { Credential } from '@geekmidas/constructs/credential';
import { z } from 'zod';

/** Read by the worker's cron alone. */
export const push = new Credential('Push', {
  schema: z.object({ key: z.string() }),
});
`,
	);
	write(
		'apps/reviewer/endpoints/review.ts',
		`import { z } from 'zod';
import { authDatabase } from '../../../constructs/database.js';
import { reviewer } from '../../../constructs/reviewer.js';

/** Reads the auth tenant, and nothing else. */
export const review = reviewer
  .database(authDatabase)
  .get('/review')
  .output(z.object({ ok: z.boolean() }))
  .handle(async () => ({ ok: true }));
`,
	);
	write(
		'apps/api/crons/sweep.ts',
		`import { push } from '../../../constructs/push.js';
import { worker } from '../../../constructs/worker.js';

/** The worker's, sitting in the API's directory. */
export const sweep = worker
  .cron('rate(1 day)')
  .dependsOn([push])
  .handle(async () => null);
`,
	);
	write(
		'apps/reviewer/package.json',
		`${JSON.stringify({ name: `@${name}/reviewer`, private: true, type: 'module' }, null, 2)}\n`,
	);
}

/**
 * The workspace at `dir`, its manifest, its runnables' edges, and where each
 * worker's work is declared.
 */
export async function loadComposeApp(dir: string): Promise<{
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	runnables: Record<string, string[]>;
	background: Record<string, string[]>;
}> {
	const { workspace } = await loadWorkspaceConfig(dir);
	const runnables: Record<string, string[]> = {};
	const background: Record<string, string[]> = {};
	const manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
		runnables,
		background,
	});
	return { workspace, manifest, runnables, background };
}

/** The documentation address the fixture's servers stand on. */
export const SERVER_IPV4 = '203.0.113.10';

/**
 * The stage's server, as `gkm secrets:set GKM_SERVER_IPV4` stores it: what a
 * deployed stage that serves a domain must have before a deploy runs. Only
 * that key — nothing a deploy would generate.
 */
export async function serveFrom(
	dir: string,
	stage = 'production',
	ipv4 = SERVER_IPV4,
	home?: string,
): Promise<void> {
	const { loadWorkspaceSettings } = await import('../../../config');
	const { secretsStoreFor } = await import('../../../secrets/store');
	const { initStageSecrets } = await import('../../../secrets/storage');
	const workspace = await loadWorkspaceSettings(dir);
	const store = await secretsStoreFor(workspace, stage, home ? { home } : {});
	// Written under another GKM_HOME's key, it is unreadable here: start over.
	const stored =
		(await store.read(stage).catch(() => null)) ?? initStageSecrets(stage);
	await store.write(stage, {
		...stored,
		custom: { ...stored.custom, GKM_SERVER_IPV4: ipv4 },
	});
}

/** A resolver that answers every host with the fixture's server. */
export const resolvesHere = async (): Promise<string[]> => [SERVER_IPV4];

/** Whether the stage's secrets hold more than the server's address. */
export async function stageGenerated(
	dir: string,
	stage = 'production',
): Promise<boolean> {
	const { loadWorkspaceSettings } = await import('../../../config');
	const { secretsStoreFor } = await import('../../../secrets/store');
	const workspace = await loadWorkspaceSettings(dir);
	const stored = await (await secretsStoreFor(workspace, stage)).read(stage);
	if (!stored) return false;
	return (
		stored.seed !== undefined ||
		Object.keys(stored.custom).some((key) => !key.startsWith('GKM_SERVER_'))
	);
}
