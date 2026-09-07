/**
 * The apps a manifest implies.
 *
 * `gkm.config.ts` used to carry an `apps` block naming every app: its type, its
 * path, its port, its framework, which other apps it depended on. Every one of
 * those facts was already declared. A `StaticSite('Web', { path: 'apps/web' })`
 * and an `apps.web = { type: 'web', path: 'apps/web', framework: 'vite',
 * dependencies: ['api'] }` are the same statement written twice, and only one of
 * them was checked against anything — so the copy in config was free to drift,
 * and a surface config had no entry for simply never deployed.
 *
 * So the list comes from the graph. A `site` is an app. A `rest-api` that named
 * an `app` is an app. A `rest-api` that did not is served by the surface that
 * named it as its authenticator, which is the same collapsing rule the deploy
 * already used, now stated once and read by everybody.
 *
 * What config still supplies is what no graph can answer: the backends a cache
 * and a mailer resolve to, the deploy endpoint, the stage's domain.
 */

import { type ConstructManifest, kebabCase } from '@geekmidas/manifest';
import type {
	AppDomainConfig,
	DeployTarget,
	Framework,
	NormalizedAppConfig,
	NormalizedWorkspace,
} from './types.js';

/** Which frontend framework builds each site variant. */
const FRAMEWORKS: Record<string, Framework> = {
	static: 'vite',
	next: 'nextjs',
	tanstack: 'tanstack-start',
};

/**
 * The app key a construct id becomes.
 *
 * The same kebab form every physical name is built from, so `Api` is `api` in
 * the config, `production-kitchen-sink-api` on Dokploy, and `API_URL` in an
 * environment — one id, three renderings, no second list.
 */
export function appKey(id: string): string {
	return kebabCase(id);
}

/**
 * The surface that actually serves a given surface.
 *
 * A surface with an `app` serves itself. One without is mounted into whichever
 * surface named it with `.auth()` — the auth server case, and the only one
 * where two surfaces legitimately share a process. Resolved transitively, and
 * defensively: a cycle returns the id it started from rather than hanging.
 */
export function hostOf(
	manifest: ConstructManifest,
	id: string,
	seen: ReadonlySet<string> = new Set(),
): string | undefined {
	const declaration = manifest[id];
	if (!declaration || declaration.kind !== 'rest-api') return undefined;
	if (declaration.app) return id;
	if (seen.has(id)) return undefined;

	for (const [candidateId, candidate] of Object.entries(manifest)) {
		if (candidate.kind !== 'rest-api' || candidate.auth !== id) continue;
		const host = hostOf(manifest, candidateId, new Set([...seen, id]));
		if (host) return host;
	}

	return undefined;
}

/**
 * Local ports, assigned so that adding a site does not renumber the others.
 *
 * Backends first, then the site holding the base domain, then the rest
 * alphabetically. The ordering is arbitrary but it is *fixed*, which is the
 * property that matters: a port that moves when an unrelated app is added is a
 * port nobody can put in a bookmark. A construct that names its own port keeps
 * it, and is skipped here.
 */
function assignPorts(apps: Record<string, NormalizedAppConfig>): void {
	const rank = (
		name: string,
		app: NormalizedAppConfig,
	): [number, number, string] => [
		app.type === 'backend' ? 0 : app.type === 'web' ? 1 : 2,
		app.root ? 0 : 1,
		name,
	];

	const ordered = Object.entries(apps).sort(([aName, a], [bName, b]) => {
		const [at, ar, an] = rank(aName, a);
		const [bt, br, bn] = rank(bName, b);
		return at - bt || ar - br || an.localeCompare(bn);
	});

	const taken = new Set(
		ordered.map(([, app]) => app.port).filter((p): p is number => !!p),
	);

	let next = 3000;
	for (const [, app] of ordered) {
		if (app.port) continue;
		while (taken.has(next)) next += 1;
		app.port = next;
		taken.add(next);
	}
}

/**
 * Whichever site holds the base domain.
 *
 * The convention first — a site named `web` — because it is one people already
 * rely on. Then an explicit `root: true`. A project with one site needs neither.
 */
function markRoot(apps: Record<string, NormalizedAppConfig>): void {
	const sites = Object.entries(apps).filter(([, a]) => a.type === 'web');
	if (sites.length === 0) return;
	if (sites.some(([, a]) => a.root)) return;

	const chosen =
		sites.find(([name]) => name === 'web') ??
		(sites.length === 1 ? sites[0] : undefined);
	if (chosen) chosen[1].root = true;
}

export function derivedApps(
	manifest: ConstructManifest,
	workspace: NormalizedWorkspace,
): Record<string, NormalizedAppConfig> {
	const apps: Record<string, NormalizedAppConfig> = {};
	const defaultTarget: DeployTarget = workspace.deploy?.default ?? 'dokploy';

	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind !== 'site' && declaration.kind !== 'rest-api')
			continue;

		const spec = declaration.app;
		if (!spec) continue;

		const name = appKey(id);
		// A config entry of the same name still wins, so a workspace can override
		// one field without restating the app. Nothing in this repo needs to.
		const configured = workspace.apps[name];

		apps[name] = {
			...configured,
			type: declaration.kind === 'site' ? 'web' : 'backend',
			path: spec.path,
			port: spec.port ?? configured?.port ?? 0,
			dependencies: [],
			resolvedDeployTarget: configured?.resolvedDeployTarget ?? defaultTarget,
			...(declaration.kind === 'site'
				? {
						framework: configured?.framework ?? FRAMEWORKS[declaration.variant],
						...(declaration.root ? { root: true } : {}),
						...(spec.config ? { config: spec.config } : {}),
					}
				: {}),
			...(spec.routes !== undefined ? { routes: spec.routes } : {}),
			...(spec.functions !== undefined ? { functions: spec.functions } : {}),
			...(spec.crons !== undefined ? { crons: spec.crons } : {}),
			...(spec.queues !== undefined ? { queues: spec.queues } : {}),
			...(spec.topics !== undefined ? { topics: spec.topics } : {}),
			...(spec.subscribers !== undefined
				? { subscribers: spec.subscribers }
				: {}),
			...(spec.envParser !== undefined ? { envParser: spec.envParser } : {}),
			...(spec.logger !== undefined ? { logger: spec.logger } : {}),
			...(spec.telescope !== undefined ? { telescope: spec.telescope } : {}),
			...(spec.studio !== undefined ? { studio: spec.studio } : {}),
			...(spec.openapi !== undefined ? { openapi: spec.openapi } : {}),
			...(spec.runtime !== undefined ? { runtime: spec.runtime } : {}),
			...(spec.env !== undefined ? { env: spec.env } : {}),
			...(spec.entry !== undefined ? { entry: spec.entry } : {}),
			...(configured?.domain
				? { domain: configured.domain as AppDomainConfig }
				: {}),
		} as NormalizedAppConfig;
	}

	// Build order, from the edges rather than from a hand-kept list. A site that
	// depends on a surface depends on the app that serves it — which for a
	// mounted auth server is its host, not a container that does not exist.
	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind !== 'site' && declaration.kind !== 'rest-api')
			continue;

		const app = apps[appKey(id)];
		if (!app) continue;

		const edges =
			declaration.kind === 'site'
				? declaration.dependencies
				: (declaration.calls ?? []);

		const names = new Set<string>();
		for (const edge of edges) {
			if (edge.kind !== 'rest-api') continue;
			const host = hostOf(manifest, edge.target);
			if (!host) continue;
			const key = appKey(host);
			if (key !== appKey(id) && apps[key]) names.add(key);
		}

		app.dependencies = [...names].sort();
	}

	markRoot(apps);
	assignPorts(apps);

	// Apps config declared that the graph knows nothing about — a `type: 'mobile'`
	// entry, or a hand-run process. Kept rather than dropped: config is still the
	// escape hatch for what nothing declares.
	for (const [name, app] of Object.entries(workspace.apps)) {
		if (!apps[name]) apps[name] = app;
	}

	return apps;
}
