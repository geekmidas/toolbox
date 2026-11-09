/**
 * The stack's own edge, rendered for Caddy: one site block per route.
 *
 * Deployed, each host is the stage's real domain and Caddy gets it a
 * certificate from Let's Encrypt on first request — the same automatic HTTPS
 * it does anywhere, with nothing to configure but the name — or serves the
 * stage's own certificate (`deploy.compose.tls`). Locally the hosts are
 * `*.localhost` and the certificate is the one gkm's local authority issued,
 * as the `gkm dev` edge's is, so a local stack is `https://` like a deployed
 * one.
 *
 * Pure: the routes are data (`@geekmidas/edge/routes`), and rendering them is one string.
 */

import { CLIENT_IP_HEADER, EDGE_TOKEN_HEADER } from '@geekmidas/manifest';
import {
	assertRouteRenderable,
	type EdgeRoute,
	type EdgeTls,
	type Upstream,
} from '../routes';

/** Where Caddy reads a stage's own certificate, inside its container. */
export const CADDY_TLS_DIR = '/etc/caddy/tls';

export interface CaddyfileOptions {
	tls: EdgeTls;
	/**
	 * The stack's token, on which a service of the stack keeps gkm's client
	 * address through the edge — see `clientIpRule`.
	 */
	edgeToken?: string;
	/** Where ACME sends expiry notices, when someone wants them. */
	email?: string;
	/**
	 * `false` on the local stage: plain HTTP is not sent to HTTPS, whose
	 * published port there may not be 443.
	 */
	redirects?: boolean;
}

/** An upstream on the stack's own network: its service name. */
function address({ service, port }: Upstream): string {
	return `${service}:${port}`;
}

/** The Caddyfile for a stack's edge. */
export function edgeCaddyfile(
	routes: readonly EdgeRoute[],
	options: CaddyfileOptions,
): string {
	const { tls } = options;
	// A wildcard site certified host by host: Caddy asks its `hosts` route
	// before it gets a certificate for one, so a name no tenant has is never
	// sent to Let's Encrypt.
	const ask = routes.find((route) => route.wildcard?.tls.kind === 'on-demand')
		?.wildcard?.tls;
	const onDemand =
		ask?.kind === 'on-demand'
			? `
	on_demand_tls {
		ask ${ask.ask}
	}`
			: '';
	const settings = `${options.email ? `\n\temail ${options.email}` : ''}${
		options.redirects === false ? '\n\tauto_https disable_redirects' : ''
	}${onDemand}`;
	const global = settings ? `{${settings}\n}` : '';

	const certificate =
		tls.kind === 'files'
			? `
	tls ${tls.certFile} ${tls.keyFile}
`
			: '';

	// The wildcard site last: Caddy prefers a named host to `*.<domain>`
	// wherever the blocks are, and reading it last says the same.
	const blocks = [
		...routes.filter((route) => !route.wildcard),
		...routes.filter((route) => route.wildcard),
	].map((route) =>
		siteBlock(
			route,
			options.edgeToken,
			route.wildcard?.tls.kind === 'on-demand'
				? `
	tls {
		on_demand
	}
`
				: certificate,
		),
	);

	// No blank line under the header: `caddy fmt` wants the first block there.
	return `${HEADER}${global ? `${global}\n\n` : ''}${blocks.join('\n\n')}\n`;
}

/** One route's site block. */
function siteBlock(
	route: EdgeRoute,
	edgeToken: string | undefined,
	certificate: string,
): string {
	assertRouteRenderable(route);
	const { host, allow, auth, paths, prefixes, requireHeader, handlers } = route;
	const allowed = [
		...(paths ?? []),
		...(prefixes ?? []).map((prefix) => `${prefix}*`),
	];

	const except = route.wildcard?.except ?? [];
	const checks = `${
		except.length
			? `
	# Labels no tenant may take, although nothing in this stack answers them.
	@protected host ${except.map((label) => `${label}.${route.wildcard?.domain}`).join(' ')}
	respond @protected 404
`
			: ''
	}${
		allow
			? `
	# Only these addresses — the peer Caddy sees, never a header a client
	# could set. Everything else is refused before it reaches the upstream.
	@denied not remote_ip ${allow.join(' ')}
	respond @denied 403
`
			: ''
	}${
		requireHeader
			? `
	# Only what the CDN sends: it adds this header to every request, and this
	# host would be reached around the CDN otherwise.
	@forged not header ${requireHeader.name} "${requireHeader.value}"
	respond @forged 403
`
			: ''
	}${
		auth
			? `
	# The stage's login, asked for before anything reaches the upstream.
	basic_auth {
		${auth.user} ${auth.hash}
	}
`
			: ''
	}${
		allowed.length
			? `
	# Only these paths answer. Everything else on this host is refused before
	# it reaches the upstream.
	@elsewhere not path ${allowed.join(' ')}
	respond @elsewhere 404
`
			: ''
	}`;

	const proxy = proxyBlock(route);
	const body = handlers?.length
		? `${handlers
				.map(
					(handler, index) => `
	# Answered by another service: ${handler.name}.
	@handler${index} path ${handler.prefixes.map((prefix) => `${prefix}*`).join(' ')}
	handle @handler${index} {
		reverse_proxy ${handler.upstreams.map(address).join(' ')}
	}
`,
				)
				.join('')}
	handle {${proxy.replace(/\n/g, '\n\t')}
	}`
		: proxy;

	// Its aliases join the block: every check and handler holds on each.
	const names = [host, ...(route.aliases ?? [])]
		.map((name) => `https://${name}`)
		.join(', ');
	// Each redirect host, a block of its own that sends the browser to the
	// canonical host, path and query kept, and proxies nothing.
	const redirects = (route.redirects?.hosts ?? [])
		.map(
			(from) => `

https://${from} {${certificate}
	redir ${route.redirects?.to}{uri} permanent
}`,
		)
		.join('');

	return `${names} {${certificate}${clientIpRule(edgeToken)}
${checks}${body}
}${redirects}`;
}

/** Where a route's requests go, when no handler took them. */
function proxyBlock(route: EdgeRoute): string {
	const { upstreams, prefix, streaming } = route;
	const health = healthCheck(route);
	return prefix
		? `
	# A bucket, served at a host of its own: the bucket is a prefix on MinIO,
	# which routes and signs on the Host header — so it is sent the upstream's.
	reverse_proxy ${upstreams.map(address).join(' ')} {
		rewrite ${prefix}{uri}
		header_up Host {upstream_hostport}${health}
	}`
		: `
	# Host and X-Forwarded-* are passed through as Caddy does by default, so
	# an app builds redirects, cookies and links on the address a caller used.
	reverse_proxy ${upstreams.map(address).join(' ')}${
		streaming || health
			? ` {${
					streaming
						? `
		# Never buffer: a streamed response — server-sent events, a Next.js
		# RSC payload — reaches the client as each chunk is written.
		flush_interval -1`
						: ''
				}${health}
	}`
			: ''
	}`;
}

/**
 * Caddy's own check of each upstream, as the Traefik edge's
 * `loadBalancer.healthCheck`: one that stops answering is taken out of
 * rotation until it does again. Caddy starts once its apps have — not once
 * they are healthy — so this is what keeps a request from an upstream that
 * is not up, and a route to an app with none up answers an error (503)
 * rather than going missing.
 */
function healthCheck({ health }: EdgeRoute): string {
	return health
		? `
		# Each upstream asked on its own: one that stops answering is out of
		# rotation until it answers again.
		health_uri ${health}
		health_interval 5s
		health_timeout 3s`
		: '';
}

const HEADER = `# Generated by gkm compose from the construct manifest — do not edit.
#
# One host per API and site, each in front of its own container, one per
# file server in front of the stack's MinIO — its processors' paths sent to
# their own service — one per worker SNS pushes to and per processor unit a
# CDN reaches, answering only those paths, and — when its logs are served
# publicly — one for OpenObserve, to the addresses it allows. A site the
# stage puts behind a password asks for its login first.
`;

/**
 * The lines every site block of an edge opens with, for gkm's own
 * `x-gkm-client-ip` — the client address the auth server rate-limits by.
 *
 * Only a service of this stack may send it. One that calls a sibling at its
 * public address comes through this edge, and proves where it comes from with
 * the stack's token (`x-gkm-edge-token`), derived from the stage's seed and
 * handed to every process of the stack — never to a browser. A request
 * without it has the header removed, so nobody outside can choose the address
 * they are rate-limited by. Without a token, it is removed from every request.
 */
export function clientIpRule(edgeToken: string | undefined): string {
	if (!edgeToken) {
		return `
	# gkm's own header, which only a service of this stack may send: the auth
	# server rate-limits by the client address it carries.
	request_header -${CLIENT_IP_HEADER}`;
	}
	return `
	# gkm's own header, which only a service of this stack may send — proven by
	# the stack's token: the auth server rate-limits by the client address it
	# carries. Removed from every other request.
	@gkm_outside not header ${EDGE_TOKEN_HEADER} ${edgeToken}
	request_header @gkm_outside -${CLIENT_IP_HEADER}`;
}
