/**
 * The local edge's routes, rendered for the Caddy of this project's — the
 * proxy `gkm dev` and `gkm test` run behind unless the local stage's
 * `deploy.compose.proxy` is Traefik (see `localEdge.ts`).
 *
 * The routes are data (`routes.ts`, as `@geekmidas/edge/routes` models them
 * for every proxy); this is one adapter over them. One Caddy serves every
 * stage — the same way one Postgres holds `orders` and `orders_test` — so its
 * root config only imports, and each stage's routes are a file of their own.
 *
 * Pure, like `composeFor`: rendering the routes is one string.
 */

import { clientIpRule } from '@geekmidas/edge/proxy/caddy';
import {
	type EdgeRoute,
	type Upstream,
	upstreamAddress,
} from '@geekmidas/edge/routes';

/** Where the edge's container reads `.gkm/caddy-sites/` — routes and certificates. */
export const CADDY_SITES_IN_CONTAINER = '/etc/caddy/sites';

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
	# No ACME, no public DNS: each stage's certificate is gkm's, beside its
	# routes, and the names are local.
	auto_https disable_redirects
}

# One file per stage, so two stages share this edge the way they already share
# one Postgres and one MinIO.
import ${CADDY_SITES_IN_CONTAINER}/*.caddy
`;
}

/** An upstream as Caddy dials it from this project's network. */
function dial(upstreams: readonly Upstream[]): string {
	return upstreams
		.map((upstream) => `http://${upstreamAddress(upstream)}`)
		.join(' ');
}

/**
 * One stage's routes, as the file imported above.
 *
 * `rewrite` rather than a path prefix on the address: the bucket is the
 * origin's business, and the client asks for the key it stored.
 *
 * `header_up Host {upstream_hostport}` matters more than it looks. MinIO routes
 * and signs on the Host header, so forwarding the requested hostname would make
 * it look for a bucket named after the domain.
 */
export function toCaddyfile(
	routes: readonly EdgeRoute[],
	options: {
		/**
		 * The stage's certificate and key, one PEM file, as the edge's
		 * container reads it.
		 */
		certificate: string;
		/** The stack's token: see {@link clientIpRule}. */
		edgeToken?: string;
	},
): string {
	if (routes.length === 0) {
		return `${GENERATED}
# No file server is declared in this stage, so it routes nothing.
`;
	}

	const blocks = routes.map((route) => {
		const { host, prefix, handlers, wildcard, aliases, redirects } = route;
		const proxy = `reverse_proxy ${dial(route.upstreams)} {${
			prefix
				? `
		rewrite ${prefix}{uri}
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
	}`;

		// Each redirect host, one block: the browser is sent to the
		// canonical host with its path and query, and nothing is proxied.
		const redirectBlocks = (redirects?.hosts ?? [])
			.map(
				(from) => `
https://${from} {
	tls ${options.certificate} ${options.certificate}

	redir ${redirects?.to}{uri} permanent
}`,
			)
			.join('');
		const names = [host, ...(aliases ?? [])]
			.map((name) => `https://${name}`)
			.join(', ');

		return `
${names} {
	tls ${options.certificate} ${options.certificate}

${clientIpRule(options.edgeToken)}
${(handlers ?? [])
	.map(
		(handler) => `
	# Its processors' patterns, to the dev server holding them — under the
	# route it mounts them on. Answered there, so the bucket below never is.
	@${handler.name} path ${handler.prefixes.map((p) => `${p}*`).join(' ')}
	handle @${handler.name} {
		reverse_proxy ${dial(handler.upstreams)} {${
			handler.under
				? `
			rewrite ${handler.under}{uri}`
				: ''
		}
			header_up Host {host}
		}
	}
`,
	)
	.join('')}${wildcard ? tenantBlock(wildcard, proxy) : `	${proxy}`}
}${redirectBlocks}`;
	});

	return `${GENERATED}${blocks.join('\n')}\n`;
}

/**
 * A wildcard site's routes: a protected host refused, every other host asked
 * about before it is proxied. `handle` blocks rather than bare directives,
 * because Caddy orders directives itself and would proxy before it refused.
 */
function tenantBlock(
	wildcard: NonNullable<EdgeRoute['wildcard']>,
	proxy: string,
): string {
	const refused = wildcard.except.length
		? `
	# Labels an app answers on, or that the workspace protects: never a
	# tenant's, whether or not anything is running on them.
	@protected host ${wildcard.except.map((label) => `${label}.${wildcard.domain}`).join(' ')}
	handle @protected {
		respond 404
	}
`
		: '';
	const check = wildcard.hosts
		? `
		# Which hosts are tenants is the app's to say: its \`hosts\` route
		# answers 200 to serve this one, and anything else goes back as is.
		forward_auth ${dial([wildcard.hosts.upstream])} {
			uri ${wildcard.hosts.path}?domain={host}
		}
`
		: '';

	return `${refused}
	handle {${check}
		${proxy.replaceAll('\n', '\n\t')}
	}`;
}

const GENERATED = `# Generated by gkm from the construct manifest — do not edit.
#
# One host per declared file server, in front of the object store that holds its
# objects. This is the shape a file server has deployed — a domain serving a
# bucket — which MinIO alone cannot produce: its virtual-host mode reads the
# leading label as the bucket name.
#
# Certificates come from gkm's local CA. "gkm dev" and "gkm test" point Node at
# its root, so nothing has to be installed to use these URLs from code; a
# browser needs the root trusted once ("gkm trust").
`;
