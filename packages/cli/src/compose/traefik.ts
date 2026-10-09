/**
 * The server's shared edge, rendered for Traefik: what the edge itself runs
 * with, and what one stack registers with it.
 *
 * One Traefik per server owns 80 and 443, the ACME state and the redirect to
 * HTTPS. It is configured through its file provider alone: each stack writes
 * one file — its routers, services and middlewares, every name prefixed with
 * its compose project — into a directory the edge watches, and removes it
 * when it stops. There is no Docker socket: the edge never learns what runs
 * on the server except from those files.
 *
 * The edge and the stacks meet on one external Docker network. Only a
 * stack's public services join it, each under an alias prefixed with its
 * project (`<project>-api`), because the network is shared: a bare service
 * name there would be answered by every stack's `api`.
 *
 * Pure: the documents are data, and the edge's side effects are `edge.ts`'s.
 */

import { createHash } from 'node:crypto';
import { CLIENT_IP_HEADER } from '@geekmidas/manifest';
import { stringify } from 'yaml';
import type { EdgeRoute, EdgeTls, Upstream } from './routes.js';

/**
 * The image, pinned: the edge is every stack's way in, so a new version is a
 * change to this line, not whatever `latest` is on the day a server starts.
 */
export const TRAEFIK_IMAGE = 'traefik:v3.7.13';

/** The edge's compose project, one per server. */
export const EDGE_PROJECT = 'gkm-edge';

/** The external network the edge and every stack's public services share. */
export const EDGE_NETWORK = 'gkm-edge';

/** The edge's compose service. */
export const EDGE_SERVICE = 'traefik';

/** Inside the edge's container: what it watches, and where certificates are. */
export const EDGE_DYNAMIC_DIR = '/etc/gkm-edge/dynamic';
export const EDGE_CERTS_DIR = '/etc/gkm-edge/certs';

/** The certificate resolver every deployed route without its own certificate uses. */
export const ACME_RESOLVER = 'letsencrypt';

/** The internal entrypoint the edge's health check asks; never published. */
const PING_PORT = 8082;

/** A stack's service, as the edge — and the stack itself — reach it. */
export function edgeAlias(project: string, service: string): string {
	return `${project}-${service}`;
}

/** A stack's certificate, as the edge's container reads it. */
export function edgeCertificatePaths(project: string): {
	certFile: string;
	keyFile: string;
} {
	return {
		certFile: `${EDGE_CERTS_DIR}/${project}.crt`,
		keyFile: `${EDGE_CERTS_DIR}/${project}.key`,
	};
}

/** The edge's ports on the host. */
export interface EdgePorts {
	https: number;
	http: number;
}

/**
 * The edge's static configuration: the entrypoints, the redirect, ACME, and
 * the directory it watches. No API and no dashboard — nothing about the edge
 * is reachable but the routes stacks register.
 */
export function traefikStatic(ports: EdgePorts): Record<string, unknown> {
	return {
		global: { checkNewVersion: false, sendAnonymousUsage: false },
		entryPoints: {
			web: {
				address: ':80',
				http: {
					// Every plain-HTTP request is sent to HTTPS — but an ACME
					// HTTP-01 challenge, which Traefik answers before the redirect.
					redirections: {
						entryPoint: {
							// The published port when it is not 443, so the redirect
							// lands where the edge actually listens.
							to: ports.https === 443 ? 'websecure' : `:${ports.https}`,
							scheme: 'https',
							permanent: true,
						},
					},
				},
			},
			websecure: { address: ':443' },
			ping: { address: `:${PING_PORT}` },
		},
		ping: { entryPoint: 'ping' },
		providers: {
			file: { directory: EDGE_DYNAMIC_DIR, watch: true },
		},
		certificatesResolvers: {
			[ACME_RESOLVER]: {
				acme: {
					storage: '/acme/acme.json',
					httpChallenge: { entryPoint: 'web' },
				},
			},
		},
		log: { level: 'INFO' },
	};
}

/** The edge's compose document. */
export function edgeCompose(options: {
	ports: EdgePorts;
	/**
	 * The static configuration, as written: handed to the container inline
	 * (`configs.content`), so nothing is read from a path on whichever machine
	 * runs the deploy — and its hash recreates the edge when it changes.
	 */
	staticConfig: string;
	logging: { driver: string; options: Record<string, string> };
}): Record<string, unknown> {
	const { ports } = options;
	return {
		name: EDGE_PROJECT,
		services: {
			[EDGE_SERVICE]: {
				image: TRAEFIK_IMAGE,
				restart: 'unless-stopped',
				ports: [`${ports.https}:443`, `${ports.http}:80`],
				configs: [{ source: 'traefik', target: '/etc/traefik/traefik.yml' }],
				volumes: [
					// Volumes on the server, written through the engine (`docker
					// exec`): each stack's routes and certificate, replaced by a
					// rename the file provider sees whole.
					`dynamic:${EDGE_DYNAMIC_DIR}`,
					`certs:${EDGE_CERTS_DIR}`,
					'acme:/acme',
				],
				// Static configuration is read at start: a change to it is a
				// change to the service, so `up` recreates the edge.
				labels: {
					'dev.geekmidas.edge.config': createHash('sha256')
						.update(options.staticConfig)
						.digest('hex')
						.slice(0, 16),
				},
				networks: ['edge'],
				healthcheck: {
					test: ['CMD', 'traefik', 'healthcheck', '--ping'],
					interval: '10s',
					timeout: '5s',
					retries: 5,
				},
				logging: options.logging,
			},
		},
		configs: { traefik: { content: options.staticConfig } },
		volumes: { acme: {}, dynamic: {}, certs: {} },
		networks: { edge: { name: EDGE_NETWORK, external: true } },
	};
}

/** What a stack registers with the edge — its routes, and its certificate. */
export interface TraefikStackOptions {
	project: string;
	/** ACME, or the stage's own certificate. Never the local CA: that is Caddy's. */
	tls: Exclude<EdgeTls, { kind: 'internal' }>;
}

/** A stack's dynamic configuration, as an object. */
export function traefikDynamic(
	routes: readonly EdgeRoute[],
	options: TraefikStackOptions,
): Record<string, unknown> {
	const { project, tls } = options;
	const name = (route: EdgeRoute, suffix?: string) =>
		`${project}-${route.name}${suffix ? `-${suffix}` : ''}`;
	const url = ({ service, port }: Upstream) =>
		`http://${edgeAlias(project, service)}:${port}`;

	const routers: Record<string, unknown> = {};
	const services: Record<string, unknown> = {};
	const middlewares: Record<string, unknown> = {};

	// gkm's own header, which only a service of this stack may send — the
	// auth server rate-limits by the client address it carries — removed from
	// every request that arrives from outside. An empty value is Traefik's
	// way of removing a request header.
	const strip = `${project}-strip-gkm-headers`;
	if (routes.length > 0) {
		middlewares[strip] = {
			headers: { customRequestHeaders: { [CLIENT_IP_HEADER]: '' } },
		};
	}

	for (const route of routes) {
		const chain: string[] = [strip];
		if (route.allow) {
			// The peer Traefik sees — never X-Forwarded-For, which a client
			// could set. Everything else gets 403.
			middlewares[name(route, 'allow')] = {
				ipAllowList: { sourceRange: [...route.allow] },
			};
			chain.push(name(route, 'allow'));
		}
		if (route.prefix) {
			middlewares[name(route, 'prefix')] = {
				addPrefix: { prefix: route.prefix },
			};
			chain.push(name(route, 'prefix'));
		}

		routers[name(route)] = {
			rule: `Host(\`${route.host}\`)`,
			entryPoints: ['websecure'],
			service: name(route),
			middlewares: chain,
			tls: tls.kind === 'acme' ? { certResolver: ACME_RESOLVER } : {},
		};

		services[name(route)] = {
			loadBalancer: {
				servers: route.upstreams.map((upstream) => ({ url: url(upstream) })),
				// A bucket is routed and signed on the Host header, so MinIO is
				// sent its own; an app is sent the one the caller used, which is
				// what it builds redirects, cookies and links on.
				...(route.prefix ? { passHostHeader: false } : {}),
				...(route.streaming
					? {
							// Never buffer: each chunk of a streamed response is
							// flushed to the client as it is written.
							responseForwarding: { flushInterval: '-1ms' },
						}
					: {}),
				...(route.health
					? {
							healthCheck: {
								path: route.health,
								interval: '5s',
								timeout: '3s',
							},
						}
					: {}),
			},
		};
	}

	return {
		http: {
			routers,
			services,
			...(Object.keys(middlewares).length > 0 ? { middlewares } : {}),
		},
		...(tls.kind === 'files'
			? {
					tls: {
						certificates: [{ certFile: tls.certFile, keyFile: tls.keyFile }],
					},
				}
			: {}),
	};
}

/** A stack's dynamic configuration file, as written to the edge's directory. */
export function traefikDynamicFile(
	routes: readonly EdgeRoute[],
	options: TraefikStackOptions,
): string {
	return `# Generated by gkm compose for ${options.project} — do not edit.
# The shared edge (${EDGE_PROJECT}) reads every file in this directory; this
# one is removed by gkm compose --down.
${yaml(traefikDynamic(routes, options))}`;
}

/** The edge's static configuration file. */
export function traefikStaticFile(ports: EdgePorts): string {
	return `# Generated by gkm compose — the server's shared edge. Do not edit.
${yaml(traefikStatic(ports))}`;
}

/** The edge's compose file. */
export function edgeComposeFile(
	options: Parameters<typeof edgeCompose>[0],
): string {
	return `# Generated by gkm compose — the server's shared edge. Do not edit.
#
# Started by the first stack that runs with proxy: 'traefik', and left
# running by gkm compose --down. Stop it, once nothing uses it, with:
#
#   docker compose -p ${EDGE_PROJECT} down
${yaml(edgeCompose(options))}`;
}

function yaml(value: unknown): string {
	return stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });
}
