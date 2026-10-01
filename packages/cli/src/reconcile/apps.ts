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

import {
	type ConstructManifest,
	dependenciesOf,
	provisionOrder,
	publicEnvFor,
} from '@geekmidas/manifest';
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

/**
 * The keys one app's environment may hold: what its own declaration provides
 * and requires, and what each construct it has an edge to provides.
 *
 * The edges, not the manifest. Every app used to be handed every key the
 * workspace resolved — a web app got the database's owner URL and the auth
 * server's signing secret, and the API got the auth server's database — which
 * is exactly what a declared edge exists to rule out. A deploy composes an
 * app's environment from its edges; so does this.
 *
 * One hop: a surface an app calls is reached over HTTP, so its URL is the
 * app's business and its database is not. A site also gets the public
 * variant of each key its bundle inlines (`NEXT_PUBLIC_API_URL`), and a surface
 * the edges of the workers whose crons and subscribers its server runs.
 *
 * `undefined` for an app no declaration describes, which gets nothing but its
 * port.
 */
export function appEnvKeys(
	manifest: ConstructManifest,
	appName: string,
	/** Each owner's runnables' edges, from discovery — see `DiscoverOptions`. */
	runnables: Readonly<Record<string, readonly string[]>> = {},
): Set<string> | undefined {
	const entry = Object.entries(manifest).find(
		([id, d]) =>
			(d.kind === 'rest-api' || d.kind === 'site' || d.kind === 'mobile-app') &&
			appKey(id) === appName,
	);
	if (!entry) return undefined;
	const [id, declaration] = entry;

	const keys = new Set<string>([
		...(declaration.provides ?? []),
		...(declaration.requires ?? []),
		// A handler the surface declares itself — an auth server's wildcard —
		// states what it needs on the handler.
		...(declaration.kind === 'rest-api'
			? declaration.endpoints.flatMap((endpoint) => endpoint.requires ?? [])
			: []),
	]);

	const edges = [
		...dependenciesOf(declaration).map((edge) => edge.target),
		// The endpoints the glob found, which the surface's node does not list.
		...(runnables[id] ?? []),
	];
	// The server the build generates — a surface whose endpoints the glob finds,
	// so it declares none — also runs the workers' crons and subscribers. One
	// that serves itself (an auth server's wildcard) runs only its own handler.
	if (declaration.kind === 'rest-api' && declaration.endpoints.length === 0) {
		for (const [otherId, other] of Object.entries(manifest)) {
			if (other.kind !== 'worker') continue;
			edges.push(
				...dependenciesOf(other).map((edge) => edge.target),
				...(runnables[otherId] ?? []),
			);
			// A server schedules its crons through the broker.
			keys.add('EVENT_PUBLISHER_CONNECTION_STRING');
			keys.add('EVENT_SUBSCRIBER_CONNECTION_STRING');
		}
	}

	for (const id of edges) {
		const target = manifest[id];
		if (!target) continue;
		for (const key of target.provides ?? []) keys.add(key);

		if (target.kind === 'queue' || target.kind === 'topic') {
			keys.add('EVENT_PUBLISHER_CONNECTION_STRING');
			keys.add('EVENT_SUBSCRIBER_CONNECTION_STRING');
		}
		// The S3 client reads its credentials beside the URL, not in it. A file
		// server is reached by its URL alone.
		if (target.kind === 'objects') {
			keys.add('AWS_ACCESS_KEY_ID');
			keys.add('AWS_SECRET_ACCESS_KEY');
			keys.add('AWS_REGION');
		}
	}

	if (declaration.kind === 'site' || declaration.kind === 'mobile-app') {
		for (const key of Object.keys(publicEnvFor(declaration, manifest))) {
			keys.add(key);
		}
	}

	return keys;
}

/** One compose service per app the workspace runs, behind the apps profile. */
export function appServices(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	containers: readonly string[],
	runnables: Readonly<Record<string, readonly string[]>> = {},
): Record<string, ComposeService> {
	const env = inNetworkEnv(workspace, manifest);
	const services: Record<string, ComposeService> = {};

	for (const [name, app] of Object.entries(workspace.apps)) {
		// A mobile app ships through its own toolchain; nothing here runs it.
		if (app.type === 'mobile' || !app.port) continue;

		const key = appKey(name);
		const health = app.type === 'web' ? '/' : '/health';
		const allowed = appEnvKeys(manifest, name, runnables);
		const own = Object.fromEntries(
			Object.entries(env).filter(([envKey]) => allowed?.has(envKey)),
		);

		services[key] = {
			image: `${key}:\${TAG:-latest}`,
			build: { context: '.', dockerfile: dockerfileOf(name, app.path) },
			profiles: [APPS_PROFILE],
			ports: [`${app.port}:${app.port}`],
			environment: {
				NODE_ENV: 'production',
				PORT: String(app.port),
				...own,
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
