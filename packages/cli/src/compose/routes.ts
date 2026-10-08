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
	/** The path the upstream answers its health on — `/health`, `/`. */
	health?: string;
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

export type { ComposeProxy } from '../workspace/types.js';
