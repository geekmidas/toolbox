/**
 * The apps, as services beside the containers their constructs derive.
 *
 * `gkm docker` used to write these by hand: every backend got
 * `DATABASE_URL=postgresql://…@postgres:5432/app` and `REDIS_URL=redis://redis`,
 * which was right only for a project whose single database happened to be
 * called `Database` — an `Orders` database publishes `ORDERS_URL`, a schema
 * tenant has a URL of its own, and buckets and mail were not wired at all.
 *
 * Now an app's environment is exactly what reconcile hands `gkm dev`: every key
 * the declared constructs provide, from the same derivation. The only
 * difference is where the addresses point — at the containers by service name
 * on the compose network, rather than at `localhost` on the ports published for
 * the host.
 *
 * Always from the *local* stage's plan, whichever stage is being reconciled:
 * `gkm test` rewrites the same file, and running the tests must not quietly
 * point these apps at the test databases.
 */

import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { appKey } from '../workspace/derive.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import type { ComposeService } from './compose.js';
import { portKeys, portsOf } from './containers.js';
import { envFor } from './env.js';
import { planFor } from './plan.js';
import { backendsOf, surfaceAddresses } from './workspace.js';

/** The profile app services carry, so `gkm dev` starts only the containers. */
export const APPS_PROFILE = 'apps';

/**
 * Where an app's image is built from.
 *
 * An app at the project root is a single-app project, whose `gkm docker`
 * writes `.gkm/docker/Dockerfile`; a workspace writes one per app.
 */
export function dockerfileOf(appName: string, path: string): string {
	return path === '.'
		? '.gkm/docker/Dockerfile'
		: `.gkm/docker/Dockerfile.${appName}`;
}

/**
 * Every construct key, addressed across the compose network.
 *
 * `envFor` is asked with a placeholder port for every port key, so each
 * `localhost:<placeholder>` in its answer names exactly one container port —
 * two containers listening on the same port inside cannot be confused — and is
 * rewritten to `<container>:<inside>`.
 */
export function inNetworkEnv(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
): Record<string, string> {
	const plan = planFor(
		manifest,
		workspace.stages.local,
		provisionOrder(manifest),
		{
			localStage: workspace.stages.local,
			...backendsOf(workspace),
		},
	);

	const placeholders: Record<string, number> = {};
	const targets = new Map<number, string>();
	let next = 49_152;
	for (const container of [...plan.containers].sort()) {
		for (const port of portsOf(container)) {
			placeholders[port.key] = next;
			targets.set(next, `${container}:${port.inside}`);
			next += 1;
		}
	}
	// Every key allocation would have assigned, so envFor finds each one.
	for (const key of portKeys(plan.containers)) {
		placeholders[key] ??= next++;
	}

	const env = envFor(plan, {
		ports: placeholders,
		project: workspace.name,
		addresses: surfaceAddresses(
			workspace,
			manifest,
			(app, port) => `http://${app}:${port}`,
		),
	});

	const rewrite = (value: string) =>
		value.replace(/(?:localhost|127\.0\.0\.1):(\d+)/g, (match, port) => {
			return targets.get(Number(port)) ?? match;
		});

	return Object.fromEntries(
		Object.entries(env).map(([key, value]) => [key, rewrite(value)]),
	);
}

/** One compose service per app the workspace runs, behind the apps profile. */
export function appServices(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	containers: readonly string[],
): Record<string, ComposeService> {
	const env = inNetworkEnv(workspace, manifest);
	const services: Record<string, ComposeService> = {};

	for (const [name, app] of Object.entries(workspace.apps)) {
		// A mobile app ships through its own toolchain; nothing here runs it.
		if (app.type === 'mobile' || !app.port) continue;

		const key = appKey(name);
		const health = app.type === 'web' ? '/' : '/health';

		services[key] = {
			image: `${key}:\${TAG:-latest}`,
			build: { context: '.', dockerfile: dockerfileOf(name, app.path) },
			profiles: [APPS_PROFILE],
			ports: [`${app.port}:${app.port}`],
			environment: {
				NODE_ENV: 'production',
				PORT: String(app.port),
				...env,
			},
			// The edge fronts the host's browser; apps talk to each other directly.
			...(containers.some((c) => c !== 'caddy')
				? { depends_on: containers.filter((c) => c !== 'caddy') }
				: {}),
			healthcheck: {
				test: [
					'CMD',
					'wget',
					'-q',
					'--spider',
					`http://localhost:${app.port}${health}`,
				],
				interval: '10s',
				timeout: '5s',
				retries: 5,
			},
		};
	}

	return services;
}
