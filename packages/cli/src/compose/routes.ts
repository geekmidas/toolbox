/**
 * What a stack's edge serves, as data: one route per public host, and the
 * service behind it. Computed once by the stack, then rendered by whichever
 * proxy the stage runs — a Caddyfile for the stack's own Caddy, or a dynamic
 * config file for the server's shared Traefik — so the two never drift.
 *
 * Pure.
 */

/** A service of the stack that a route sends to. */
export interface Upstream {
	/** Its compose service name — `api`, `minio`. */
	service: string;
	/** The port it listens on, inside the network. */
	port: number;
}

/** One public host and what answers it. */
export interface EdgeRoute {
	/**
	 * Its name within the stack — unique there, and what a renderer names
	 * its routers and middlewares after: `api`, `files-uploads`.
	 */
	name: string;
	/** e.g. `api.example.com` */
	host: string;
	/**
	 * Where requests go. One today; a release that swaps containers without
	 * downtime routes to the old and the new while it does.
	 */
	upstreams: readonly Upstream[];
	/**
	 * Never buffer the response: a streamed one — server-sent events, a
	 * Next.js RSC payload — reaches the client as each chunk is written.
	 */
	streaming: boolean;
	/**
	 * A path prefix added before the request is sent, with the upstream's own
	 * address as `Host`: a bucket, served at a host of its own, is a prefix
	 * on MinIO, which routes and signs on the Host header.
	 */
	prefix?: string;
	/**
	 * The client addresses (IPs or CIDRs) it answers; every other is refused
	 * with 403, before the request reaches the upstream. Absent, it answers
	 * everyone. Matched against the peer the proxy sees, never a header a
	 * client could set.
	 */
	allow?: readonly string[];
	/**
	 * The only paths it answers, matched exactly; every other is refused at
	 * the edge, before the request reaches the upstream. Absent, it answers
	 * every path. A worker is reached only on the routes SNS pushes to.
	 */
	paths?: readonly string[];
	/**
	 * Path prefixes it answers besides `paths` — `/i/` admits everything
	 * under it. Together they are the whole allowlist; absent both, it
	 * answers every path. A processor unit's own host is reached only on its
	 * processors' prefixes.
	 */
	prefixes?: readonly string[];
	/**
	 * A header every request must carry, with exactly this value; any other
	 * is refused at the edge. What a CDN adds to reach its origin, so the
	 * origin's public host cannot be called around the CDN.
	 */
	requireHeader?: { name: string; value: string };
	/**
	 * Path prefixes on this host sent to another upstream, ahead of the
	 * route's own: a file server's processor patterns, to its processor unit,
	 * while every other path is the bucket. Served at the path asked for —
	 * no `prefix` — and never combined with `allow`, `paths`, `prefixes` or
	 * `requireHeader`, which would have to hold for every handler too.
	 */
	handlers?: readonly EdgeHandler[];
	/**
	 * The login every request must carry — HTTP basic auth, asked for by the
	 * edge before anything reaches the upstream. Absent, it asks for none.
	 * The password's bcrypt hash, never the password.
	 */
	auth?: { user: string; hash: string };
	/** The path the upstream answers its health on — `/health`, `/`. */
	health?: string;
	/**
	 * For a wildcard site's route, whose `host` is `*.<domain>`: every one
	 * label under the domain that no other route answers, and how its
	 * certificate is had. Named hosts always win over it.
	 */
	wildcard?: EdgeWildcard;
}

/** How a `*.<domain>` route is matched and certified. */
export interface EdgeWildcard {
	/** The domain under the `*` — `example.com`. */
	domain: string;
	/**
	 * Labels under the domain that never reach it, although no route of this
	 * stack answers them: the protected subdomains (`www`, `mail`), and a
	 * stage whose domain sits under this one's (`staging`).
	 */
	except: readonly string[];
	/**
	 * Where its certificate comes from:
	 * - `stage`: the stage's own (`deploy.compose.tls`), a wildcard one;
	 * - `dns`: one `*.<domain>` certificate from Let's Encrypt over the DNS
	 *   challenge, which the shared Traefik edge answers through Route 53;
	 * - `on-demand`: one per host, as Caddy is first asked for it, once the
	 *   site's `hosts` route — `ask`, on the stack's network — answers 200.
	 */
	tls: { kind: 'stage' } | { kind: 'dns' } | { kind: 'on-demand'; ask: string };
}

/** Some of a route's paths, answered by another upstream. */
export interface EdgeHandler {
	/** Unique within the route: what a renderer names its router after. */
	name: string;
	/** e.g. `/i/` — everything under it. */
	prefixes: readonly string[];
	upstreams: readonly Upstream[];
}

/** A route with handlers and a check that would have to hold for each of them. */
export class EdgeRouteConflict extends Error {
	constructor(readonly route: string) {
		super(
			`The edge route '${route}' sends some paths to other upstreams and also ` +
				`restricts who or what it answers. The two are not combined: give the ` +
				`restricted paths a host of their own.`,
		);
		this.name = 'EdgeRouteConflict';
	}
}

/** @throws {EdgeRouteConflict} */
export function assertRouteRenderable(route: EdgeRoute): void {
	if (
		route.handlers?.length &&
		(route.allow || route.paths || route.prefixes || route.requireHeader)
	) {
		throw new EdgeRouteConflict(route.name);
	}
}

/** Where a stack's certificates come from. */
export type EdgeTls =
	/** The local stage: the proxy's own CA — Caddy's, which `gkm trust` installs. */
	| { kind: 'internal' }
	/** A deployed stage: Let's Encrypt, over HTTP-01, on first request. */
	| { kind: 'acme' }
	/**
	 * A deployed stage's own certificate and key (`deploy.compose.tls`),
	 * as the proxy's container reads them.
	 */
	| { kind: 'files'; certFile: string; keyFile: string };

/** File descriptors a process holding sockets may open. */
export const NOFILE = { soft: 1_048_576, hard: 1_048_576 };

/**
 * What the edge runs with: a descriptor per socket, twice — the client's and
 * the upstream's — and every local port for those upstream connections. One
 * edge address to one upstream has only the ephemeral range to open
 * connections from, ~28k by Linux's default; widened, ~64k per replica.
 */
export const EDGE_LIMITS: {
	sysctls: Record<string, string>;
	ulimits: Record<string, { soft: number; hard: number }>;
} = {
	sysctls: { 'net.ipv4.ip_local_port_range': '1024 65535' },
	ulimits: { nofile: NOFILE },
};

export type { ComposeProxy } from '../workspace/types.js';
