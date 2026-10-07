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
import { composeBuildPaths } from '../docker/layout.js';
import { findBuildRoot } from '../docker/templates.js';
import { appKey } from '../workspace/derive.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import type { ComposeService } from './compose.js';
import { portKeys, portsOf } from './containers.js';
import { type EnvOptions, envFor } from './env.js';
import { type Plan, type PlanOptions, planFor } from './plan.js';
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
	/**
	 * External APIs' fakes. An image fake is a container on the network like
	 * any other; a module fake is served by `gkm dev` on the host, which an app
	 * container does not reach, so its URL is left as the host sees it.
	 */
	fakes: PlanOptions['fakes'] = {},
): Record<string, string> {
	return networkEnv(localPlan(workspace, manifest, fakes), {
		project: workspace.name,
		addresses: surfaceAddresses(
			workspace,
			manifest,
			(app, port) => `http://${app}:${port}`,
		),
	});
}

/**
 * The local stage's plan, which the app services are always written from.
 *
 * Without the edge: these apps reach each other by service name and a browser
 * reaches them on the ports this file publishes. Behind the edge every
 * surface resolved to its `*.localhost` host on the edge's port, which the
 * rewrite to the compose network then turned into an address nothing answers.
 */
function localPlan(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	fakes: PlanOptions['fakes'] = {},
): Plan {
	return planFor(manifest, workspace.stages.local, provisionOrder(manifest), {
		localStage: workspace.stages.local,
		...backendsOf(workspace),
		fakes,
		edge: false,
	});
}

/**
 * The values a site's bundler inlines, by the name it inlines them under —
 * `{ VITE_API_URL: 'http://localhost:3000' }`.
 *
 * Build arguments, not environment: a static bundle is finished when it is
 * built, so a value handed to its container at runtime reaches nothing. And
 * addresses a *browser* can open, since that is where the bundle runs — the
 * host's port for each app, never a name on the compose network.
 */
export function sitePublicArgs(
	manifest: ConstructManifest,
	appName: string,
	/** Every key the stage resolves, with surfaces at their public addresses. */
	env: Readonly<Record<string, string>>,
): Record<string, string> {
	const declaration = Object.entries(manifest).find(
		([id, d]) => d.kind === 'site' && appKey(id) === appName,
	)?.[1];
	if (declaration?.kind !== 'site') return {};

	const args: Record<string, string> = {};
	for (const key of Object.keys(publicEnvFor(declaration, manifest))) {
		const value = env[key];
		if (value !== undefined) args[key] = value;
	}
	return args;
}

/**
 * Every key a plan resolves, with each container addressed by its service
 * name on the compose network — `postgres:5432` rather than the port
 * published for the host.
 *
 * The addresses of surfaces and sites are the caller's: on the compose
 * network for a service another service calls, public for what a browser is
 * handed. `gkm compose` asks twice, once for each.
 */
export function networkEnv(
	plan: Plan,
	options: Omit<EnvOptions, 'ports'>,
): Record<string, string> {
	const placeholders: Record<string, number> = {};
	const targets = new Map<number, string>();
	let next = 49_152;
	for (const container of [...plan.containers].sort()) {
		for (const port of portsOf(container, plan.fakes)) {
			placeholders[port.key] = next;
			targets.set(next, `${container}:${port.inside}`);
			next += 1;
		}
	}
	// Every key allocation would have assigned, so envFor finds each one.
	for (const key of portKeys(plan.containers, plan.fakes)) {
		placeholders[key] ??= next++;
	}

	const env = envFor(plan, { ...options, ports: placeholders });

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
		const runsWorkers = Object.values(manifest).some(
			(other) => other.kind === 'worker',
		);
		for (const [otherId, other] of Object.entries(manifest)) {
			if (other.kind !== 'worker') continue;
			edges.push(
				...dependenciesOf(other).map((edge) => edge.target),
				...(runnables[otherId] ?? []),
			);
			// A server schedules its crons through the broker.
			keys.add('EVENT_PUBLISHER_CONNECTION_STRING');
		}
		// Each consumer reaches the thing it consumes: a queue's consumer its
		// queue, a subscriber its topic. Which subscriber binds which topic is
		// only known once the build has found them, so a server that runs the
		// workers is handed every carrier's address.
		if (runsWorkers) {
			for (const other of Object.values(manifest)) {
				if (other.kind !== 'queue' && other.kind !== 'topic') continue;
				for (const key of other.provides ?? []) keys.add(key);
			}
		}
	}

	for (const id of edges) {
		const target = manifest[id];
		if (!target) continue;
		for (const key of target.provides ?? []) keys.add(key);

		if (target.kind === 'queue' || target.kind === 'topic') {
			keys.add('EVENT_PUBLISHER_CONNECTION_STRING');
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
	fakes: PlanOptions['fakes'] = {},
): Record<string, ComposeService> {
	const plan = localPlan(workspace, manifest, fakes);
	const env = networkEnv(plan, {
		project: workspace.name,
		addresses: surfaceAddresses(
			workspace,
			manifest,
			(app, port) => `http://${app}:${port}`,
		),
	});
	// What a browser is handed: each app on the port this file publishes it on.
	const browser = networkEnv(plan, {
		project: workspace.name,
		addresses: surfaceAddresses(workspace, manifest),
	});
	const services: Record<string, ComposeService> = {};
	const buildRoot = findBuildRoot(workspace.root);

	for (const [name, app] of Object.entries(workspace.apps)) {
		// A mobile app ships through its own toolchain; nothing here runs it.
		if (app.type === 'mobile' || !app.port) continue;

		const key = appKey(name);
		const health = app.type === 'web' ? '/' : '/health';
		// Built from the build root — the package manager's, which is above the
		// workspace when it is nested in a monorepo — by the Dockerfile `gkm
		// docker` writes under the workspace.
		const build = composeBuildPaths({
			composeDir: workspace.root,
			buildRoot,
			workspaceRoot: workspace.root,
			dockerfile: dockerfileOf(name, app.path),
		});
		const ports = [`${app.port}:${app.port}`];

		// A site is a bundle: its public URLs are inlined when it is built, so
		// they are build arguments, and it reads nothing at runtime — no server
		// env, and nothing to wait for but its own server.
		if (app.type === 'web') {
			const args = sitePublicArgs(manifest, name, browser);
			services[key] = {
				image: `${key}:\${TAG:-latest}`,
				build: {
					...build,
					...(Object.keys(args).length ? { args } : {}),
				},
				profiles: [APPS_PROFILE],
				ports,
				healthcheck: healthcheck(app.port, health),
			};
			continue;
		}

		const allowed = appEnvKeys(manifest, name, runnables);
		const own = Object.fromEntries(
			Object.entries(env).filter(([envKey]) => allowed?.has(envKey)),
		);

		services[key] = {
			image: `${key}:\${TAG:-latest}`,
			build,
			profiles: [APPS_PROFILE],
			ports,
			environment: {
				NODE_ENV: 'production',
				PORT: String(app.port),
				...own,
			},
			// The edge fronts the host's browser; apps talk to each other directly.
			...(containers.some((c) => c !== 'caddy')
				? { depends_on: containers.filter((c) => c !== 'caddy') }
				: {}),
			healthcheck: healthcheck(app.port, health),
		};
	}

	return services;
}

/** An app's health check: its own server answering on `path`. */
export function healthcheck(
	port: number,
	path: string,
): NonNullable<ComposeService['healthcheck']> {
	return {
		test: ['CMD', 'wget', '-q', '--spider', `http://localhost:${port}${path}`],
		interval: '10s',
		timeout: '5s',
		retries: 5,
	};
}
