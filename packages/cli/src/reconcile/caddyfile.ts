/**
 * The Caddy configuration a plan implies.
 *
 * A file server is a *domain that serves a bucket*, and locally it had neither:
 * `UPLOADS_SERVER_URL` resolved to MinIO's path-style address, which works and
 * is not the deployed shape. MinIO's own virtual-host mode cannot fix that —
 * it reads the leading label *as the bucket name*, so it produces the right
 * shape only when the server's id and the bucket's happen to agree, and never
 * for a server fronting two buckets.
 *
 * So the mapping lives in front of MinIO instead: one host per file server,
 * rewriting the bucket in as a path prefix. That is the whole of it — no
 * caching, because caching is not what is missing locally, and a caching proxy
 * would add an invalidation story a local stack has no use for.
 *
 * What it buys beyond the shape is a certificate. Caddy issues one per host
 * from its own CA, so a local address is `https://` like the deployed one, and
 * everything downstream of that — `Secure` cookies, `SameSite`, a cookie domain
 * with more than one host under it — starts behaving the way it will in
 * production rather than the way `http://localhost` allows.
 *
 * Pure, like `composeFor`: what should exist is data, and rendering it is one
 * line at the edge.
 */

import type { Plan, PlannedResource } from './plan';

/** One host on the edge, and what answers behind it. */
export interface CaddySite {
	/** e.g. `api.kitchen-sink.localhost` */
	host: string;
	/** Where the request is sent, e.g. `http://minio:9000`. */
	upstream: string;
	/**
	 * A path to rewrite to, where the upstream expects a different one.
	 *
	 * The bucket prefix on an object store is the case. A surface and a site
	 * want none: they are already serving the paths the client asked for.
	 */
	rewrite?: string;
}

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
	site: true,
};

/**
 * How the edge reaches the host, from inside its container.
 *
 * A surface and a site are served by processes `gkm dev` starts on the host,
 * not by containers — so the edge has to leave Docker's network to reach them.
 * Docker Desktop resolves this name already; on Linux the compose definition
 * maps it to the host gateway.
 */
const HOST_GATEWAY = 'host.docker.internal';

/**
 * The suffix every local host shares.
 *
 * `.localhost` rather than a made-up TLD because it resolves to loopback
 * without touching `/etc/hosts` — macOS and systemd-resolved both answer for
 * subdomains of it, and Caddy issues internal certificates for it by default.
 */
export const LOCAL_TLD = 'localhost';

/**
 * The sites a plan implies, one per file server.
 *
 * The leading label is the *server's* stage-scoped name rather than the
 * bucket's, which is the difference that matters: two servers over one bucket
 * are a legitimate arrangement — two cache behaviours, one origin — and naming
 * the host after the bucket would make them collide.
 */
export function sitesFor(
	plan: Plan,
	project: string,
	/**
	 * Where surfaces and sites answer on the host, keyed by construct id.
	 *
	 * Assigned by whatever starts them rather than published by a container,
	 * which is why they arrive here instead of being read off a port.
	 */
	addresses: Readonly<Record<string, string>> = {},
): CaddySite[] {
	const byId = new Map(plan.resources.map((r) => [r.id, r]));
	const sites: CaddySite[] = [];

	for (const resource of plan.resources) {
		if (!EDGE_KINDS[resource.kind]) continue;

		const host = hostFor(resource, project);

		if (resource.kind === 'file-server') {
			// The bucket is a prefix on the origin, never part of the address: the
			// client asks for the key it stored.
			const origin = resource.of ? byId.get(resource.of) : undefined;
			if (!origin) continue;

			sites.push({
				host,
				upstream: 'http://minio:9000',
				rewrite: `/${origin.name}{uri}`,
			});
			continue;
		}

		// A surface or a site: a process on the host, at an address something
		// else assigned. Without one there is nothing to route to — which is the
		// ordinary state before `gkm dev` has decided where things listen.
		const address = addresses[resource.id];
		if (!address) continue;

		const port = portOf(address);
		if (!port) continue;

		sites.push({ host, upstream: `http://${HOST_GATEWAY}:${port}` });
	}

	return sites;
}

/** The port a local address answers on, defaulting by scheme. */
function portOf(address: string): string | undefined {
	try {
		const { port, protocol } = new URL(address);

		return port || (protocol === 'https:' ? '443' : '80');
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
	return [resource.name, project, LOCAL_TLD].filter(Boolean).join('.');
}

/**
 * The static root config, which only ever imports.
 *
 * Written once and identical for every stage, because the *sites* are what
 * differ and they live in their own files. That split is not tidiness: one
 * container serves every stage — the same way one Postgres holds `orders` and
 * `orders_test` — so a single Caddyfile would mean `gkm test` deleting the
 * routes `gkm dev` is serving, and each command silently breaking the other.
 */
export function caddyfileRoot(): string {
	return `${GENERATED}
{
	# No ACME, no public DNS: the CA is local and so are the names.
	local_certs
	auto_https disable_redirects
}

# One file per stage, so two stages share this edge the way they already share
# one Postgres and one MinIO.
import /etc/caddy/sites/*.caddy
`;
}

/**
 * One stage's sites, as the file imported above.
 *
 * `rewrite` rather than a path prefix on the address: the bucket is the
 * origin's business, and the client asks for the key it stored.
 *
 * `header_up Host {upstream_hostport}` matters more than it looks. MinIO routes
 * and signs on the Host header, so forwarding the requested hostname would make
 * it look for a bucket named after the domain.
 */
export function toCaddyfile(sites: readonly CaddySite[]): string {
	if (sites.length === 0) {
		return `${GENERATED}
# No file server is declared in this stage, so it routes nothing.
`;
	}

	const blocks = sites.map(
		({ host, upstream, rewrite }) => `
https://${host} {
	tls internal

	reverse_proxy ${upstream} {${
		rewrite
			? `
		rewrite ${rewrite}
		# MinIO routes and signs on the Host header, so forwarding the requested
		# hostname would make it look for a bucket named after the domain.
		header_up Host {upstream_hostport}`
			: `
		# The application reads whatever address was injected, so it has to see
		# the one a caller used — that is what makes a redirect, a cookie domain
		# and a generated link point back here rather than at the upstream.
		header_up Host {host}
		header_up X-Forwarded-Proto {scheme}`
	}
	}
}`,
	);

	return `${GENERATED}${blocks.join('\n')}\n`;
}

const GENERATED = `# Generated by gkm from the construct manifest — do not edit.
#
# One host per declared file server, in front of the object store that holds its
# objects. This is the shape a file server has deployed — a domain serving a
# bucket — which MinIO alone cannot produce: its virtual-host mode reads the
# leading label as the bucket name.
#
# Certificates come from Caddy's own CA. "gkm dev" and "gkm test" export its
# root and point Node at it, so nothing has to be installed to use these URLs
# from code; a browser needs the root trusted once.
`;
