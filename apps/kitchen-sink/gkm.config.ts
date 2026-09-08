import { defineWorkspace } from '@geekmidas/cli/config';

/**
 * kitchen-sink, as a workspace.
 *
 * There is no `apps` block. There used to be one, naming three apps with their
 * types, paths, ports, frameworks and dependencies — every one of which was
 * already declared. `StaticSite('Web', { path: 'apps/web' })` and
 * `apps.web = { type: 'web', path: 'apps/web', framework: 'vite',
 * dependencies: ['api'] }` are the same sentence written twice, and only one of
 * the two was checked against anything. So the copy that could drift is gone
 * and the apps are read off the graph.
 *
 * What is left here is what no graph can answer: the name every physical name
 * is scoped by, where the constructs live, which backends a cache and a mailer
 * resolve to, and where a deploy sends things.
 */
export default defineWorkspace({
	// The scope every physical name is built from: `Database` becomes
	// `production-kitchen-sink-database` on Dokploy and on AWS alike.
	name: 'kitchen-sink',

	// One glob, every kind. A database implies Postgres, a bucket implies MinIO,
	// mail implies Mailpit — none of it listed anywhere. It is also where the
	// apps come from: a `site` is an app, and so is a `rest-api` that named one.
	constructs: './constructs/**/*.ts',

	// Where the things no construct implies actually live. Backend names only —
	// whether a cache exists comes from declaring one.
	services: {
		mail: 'ses',
		events:
			(process.env.KITCHEN_SINK_EVENTS as 'pgboss' | 'sns' | 'rabbitmq') ??
			'pgboss',
	},

	// Read from the environment rather than written down, for the reason
	// `sst.config.ts` reads its sending identity that way: an endpoint and a
	// domain are one person's infrastructure, and a literal here would be that
	// person's server baked into everybody's example.
	//
	// Omitted entirely when unset, rather than passed as an empty string — the
	// workspace schema validates the endpoint as a URL, so `''` fails to load
	// the config at all, and `gkm dev` should not need a deploy target.
	deploy: {
		default: 'dokploy',
		...(process.env.DOKPLOY_ENDPOINT
			? {
					dokploy: {
						endpoint: process.env.DOKPLOY_ENDPOINT,
						registry: 'ghcr.io/technanimals',
						domains: {
							production: process.env.KITCHEN_SINK_DOMAIN ?? '',
						},
					},
				}
			: {}),
	},
});
