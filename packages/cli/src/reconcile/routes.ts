/**
 * What the local edge routes, as data: the same `EdgeRoute`s `gkm compose`
 * registers (`@geekmidas/edge/routes`), for the processes `gkm dev` runs on
 * the host and the file servers over this project's MinIO.
 *
 * A file server is a *domain that serves a bucket*, and locally it had
 * neither: `UPLOADS_URL` resolved to MinIO's path-style address, which works
 * and is not the deployed shape. MinIO's own virtual-host mode cannot fix
 * that — it reads the leading label *as the bucket name*, so it produces the
 * right shape only when the server's id and the bucket's happen to agree, and
 * never for a server fronting two buckets. So the mapping lives in front of
 * MinIO instead: one host per file server, the bucket a path prefix.
 *
 * What the edge buys beyond the shape is a certificate: gkm's local authority
 * (`@geekmidas/edge/certificates/local`) issues one for the stage's hosts, so
 * a local address is `https://` like the deployed one, and everything
 * downstream of that — `Secure` cookies, `SameSite`, a cookie domain with more
 * than one host under it — behaves the way it will in production.
 *
 * Which proxy serves them is the local stage's `deploy.compose.proxy`
 * (`proxyFor`): a Caddy of this project's (`caddyfile.ts`), or this machine's
 * shared Traefik edge (`localEdge.ts`). Both render these routes.
 *
 * Pure: what should exist is data, and rendering it is the proxy's.
 */

import type { EdgeRoute, Upstream } from '@geekmidas/edge/routes';
import { WILDCARD_SUBDOMAIN } from '@geekmidas/manifest';
import { processorsDevRoute } from '../generators/processorRoute.js';
import { appKey } from '../workspace/derive.js';
import { fileServerLabel } from '../workspace/fileServerLabel.js';
import type { Plan, PlannedResource } from './plan';

/**
 * The kinds the edge serves.
 *
 * Everything that owns a *public address*. Deployed, each of these has a real
 * hostname and a certificate, so this is what makes the local shape the same
 * one rather than a near-enough one — and the application is indifferent
 * either way, because it reads whichever address was injected and never
 * composes one.
 *
 * Adding a kind here is the whole of adding it to the edge.
 */
export const EDGE_KINDS: Readonly<Record<string, true>> = {
	'file-server': true,
	'rest-api': true,
	// The proxy passes the upgrade as it is; nothing about the route differs.
	'websocket-api': true,
	site: true,
};

/**
 * The suffix every local host shares.
 *
 * `.localhost` rather than a made-up TLD because it resolves to loopback
 * without touching `/etc/hosts` — macOS and systemd-resolved both answer for
 * subdomains of it.
 */
export const LOCAL_TLD = 'localhost';

/** MinIO, as a Caddy on this project's network reaches it. */
export const MINIO_UPSTREAM: Upstream = { service: 'minio', port: 9000 };

export interface LocalRouteOptions {
	/**
	 * Where surfaces and sites answer on the host, keyed by construct id.
	 *
	 * Assigned by whatever starts them rather than published by a container,
	 * which is why they arrive here instead of being read off a port.
	 */
	addresses?: Readonly<Record<string, string>>;
	/**
	 * Where each file server's processors answer, keyed by the file server's
	 * id: the dev server of the app holding them.
	 */
	processorAddresses?: Readonly<Record<string, string>>;
	/**
	 * Where the edge reaches MinIO: by its service name from a Caddy on this
	 * project's network (the default), or on the port it publishes on the
	 * host from the shared edge, which is on no network of this project's.
	 */
	objects?: Upstream;
	/**
	 * The edge's HTTPS port, where it is not 443: what a redirect to a
	 * canonical host keeps.
	 */
	port?: number;
}

/**
 * The routes a plan implies: one per surface and site at an address, and one
 * per file server over its bucket — named as `gkm compose` names the same
 * construct's (`api`, `files-uploads`), on the hosts it gives them.
 *
 * A file server's leading label is the *server's* stage-scoped name rather
 * than the bucket's, which is the difference that matters: two servers over
 * one bucket are a legitimate arrangement — two cache behaviours, one origin
 * — and naming the host after the bucket would make them collide.
 */
export function localRoutes(
	plan: Plan,
	project: string,
	options: LocalRouteOptions = {},
): EdgeRoute[] {
	const { addresses = {}, processorAddresses = {} } = options;
	const objects = options.objects ?? MINIO_UPSTREAM;
	const byId = new Map(plan.resources.map((r) => [r.id, r]));
	const routes: EdgeRoute[] = [];

	for (const resource of plan.resources) {
		if (!EDGE_KINDS[resource.kind]) continue;

		const host = hostFor(resource, project);

		if (resource.kind === 'file-server') {
			// The bucket is a prefix on the origin, never part of the address: the
			// client asks for the key it stored.
			const origin = resource.of ? byId.get(resource.of) : undefined;
			if (!origin) continue;

			// Its processors' patterns go to the dev server holding them, once
			// it has an address — under the route it mounts them on; everything
			// else is still the bucket.
			const address = processorAddresses[resource.id];
			const port = address ? portOf(address) : undefined;
			routes.push({
				name: `files-${appKey(resource.id)}`,
				host,
				upstreams: [objects],
				streaming: false,
				prefix: `/${origin.name}`,
				...(resource.processors?.length && port
					? {
							handlers: [
								{
									name: 'processors',
									prefixes: resource.processors,
									upstreams: [{ onHost: true, port }],
									under: processorsDevRoute(resource.id),
								},
							],
						}
					: {}),
			});
			continue;
		}

		// A surface or a site: a process on the host, at an address something
		// else assigned. Without one there is nothing to route to — which is the
		// ordinary state before `gkm dev` has decided where things listen.
		const address = addresses[resource.id];
		const port = address ? portOf(address) : undefined;
		if (!port) continue;

		const route: EdgeRoute = {
			name: appKey(resource.id),
			host,
			upstreams: [{ onHost: true, port }],
			// Never buffered: a dev server streams as a deployed app does.
			streaming: true,
		};
		if (resource.subdomain === WILDCARD_SUBDOMAIN) {
			routes.push({
				...route,
				wildcard: wildcardOf(resource, host, addresses),
			});
			continue;
		}

		const { aliases, redirects } = hostsFor(resource, project);
		const edge = options.port && options.port !== 443 ? `:${options.port}` : '';
		routes.push({
			...route,
			...(aliases.length ? { aliases } : {}),
			...(redirects.length
				? { redirects: { hosts: redirects, to: `https://${host}${edge}` } }
				: {}),
		});
	}

	return routes;
}

/**
 * What stands between a wildcard site and a host that is not a tenant.
 *
 * A named host wins over the `*` on either proxy, so `api.shop.localhost`
 * reaches the API whatever the wildcard says. What neither can know is the
 * labels nothing is running on: `www`, or an app this stage has not started.
 * Those are refused, so no slug a deploy would protect is ever served locally
 * either.
 *
 * The `hosts` route, where the surface serving it has an address, is a
 * deployed edge's check in miniature: a `2xx` lets the request through, and
 * any other answer — the app's own `404` — is what the browser gets.
 */
function wildcardOf(
	resource: PlannedResource,
	host: string,
	addresses: Readonly<Record<string, string>>,
): NonNullable<EdgeRoute['wildcard']> {
	const domain = host.slice(`${WILDCARD_SUBDOMAIN}.`.length);
	const surface = resource.hosts
		? addresses[resource.hosts.surface]
		: undefined;
	const port = surface ? portOf(surface) : undefined;

	return {
		domain,
		except: [...(resource.protectedSubdomains ?? [])],
		// gkm's local certificate names the `*.<domain>` host already.
		tls: { kind: 'stage' },
		...(resource.hosts && port
			? {
					hosts: {
						upstream: { onHost: true, port },
						path: resource.hosts.path,
					},
				}
			: {}),
	};
}

/** The port a local address answers on, defaulting by scheme. */
function portOf(address: string): number | undefined {
	try {
		const { port, protocol } = new URL(address);

		return Number(port || (protocol === 'https:' ? 443 : 80));
	} catch {
		return undefined;
	}
}

/**
 * Where one file server answers, including the stage its name carries.
 *
 * The project is a label rather than a decoration: it is what keeps two
 * checkouts from answering on one address. Omitted when there is no project to
 * name, because an empty label makes `uploads..localhost` — a host nothing
 * resolves and no certificate can be issued for.
 */
export function hostFor(resource: PlannedResource, project: string): string {
	// The root site answers on the project's bare host, as it does on the base
	// domain deployed; everything else on a subdomain of it. A stage other than
	// the local one keeps a label — the stage — because one edge serves every
	// stage, and `gkm test` claiming the bare host would take it from `gkm dev`.
	// Only under a project: without one, the "bare host" is `localhost` itself,
	// which is nobody's domain to take.
	const label =
		resource.root && project ? stageOf(resource) : labelOf(resource);

	// A wildcard site answers on every label under the stage's own domain —
	// `*.shop.localhost`, `*.test.shop.localhost` — so a stage is a label of
	// that domain rather than a suffix on the `*`.
	if (resource.subdomain === WILDCARD_SUBDOMAIN) {
		return [WILDCARD_SUBDOMAIN, stageOf(resource), project, LOCAL_TLD]
			.filter(Boolean)
			.join('.');
	}

	return [label, project, LOCAL_TLD].filter(Boolean).join('.');
}

/** Every host a resource answers on: its own, its aliases, its redirects. */
export interface ResourceHosts {
	/** The canonical one — what its `<ID>_URL` is built on. */
	host: string;
	/** Answered exactly as `host` is. */
	aliases: string[];
	/** Answered with a permanent redirect to `host`. */
	redirects: string[];
}

/**
 * Where a resource answers, every host of it: {@link hostFor}'s, and each
 * alias and redirect label under the project, carrying the stage as its own
 * label does — `www-test.shop.localhost` for `gkm test`.
 */
export function hostsFor(
	resource: PlannedResource,
	project: string,
): ResourceHosts {
	const stage = stageOf(resource);
	const under = (label: string) =>
		[stage ? `${label}-${stage}` : label, project, LOCAL_TLD]
			.filter(Boolean)
			.join('.');
	return {
		host: hostFor(resource, project),
		aliases: (resource.aliases ?? []).map(under),
		redirects: (resource.redirects ?? []).map(under),
	};
}

/**
 * A resource's own label: its `subdomain` where it declared one, and a file
 * server's own name — the label a deploy uses too — with the stage it carries
 * kept, so `gkm test` and `gkm dev` still answer on different hosts.
 */
function labelOf(resource: PlannedResource): string {
	const own =
		resource.kind === 'file-server'
			? fileServerLabel(resource.id)
			: resource.subdomain;
	if (!own) return resource.name;
	const stage = stageOf(resource);
	return stage ? `${own}-${stage}` : own;
}

/** The stage a resource's name carries, or nothing for the local stage's. */
function stageOf(resource: PlannedResource): string | undefined {
	const base = resource.id.toLowerCase();
	return resource.name === base
		? undefined
		: resource.name.slice(base.length + 1);
}
