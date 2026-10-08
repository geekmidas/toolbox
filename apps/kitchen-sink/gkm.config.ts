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
 * is scoped by, its stages, where the constructs live, and where a deploy
 * sends things. Which backend a cache or a broker resolves to follows from
 * that deploy target, so it is not here either.
 */
export default defineWorkspace({
	// The scope every physical name is built from: `Database` becomes
	// `production-kitchen-sink-database` on Dokploy and on AWS alike.
	name: 'kitchen-sink',

	// `development` locally because that is what its committed secrets are
	// stored under; deployed to the throwaway Dokploy box as `production`.
	stages: { local: 'development', deployed: ['production'] },

	// One glob, every kind. A database implies Postgres, a bucket implies MinIO,
	// mail implies Mailpit — none of it listed anywhere. It is also where the
	// apps come from: a `site` is an app, and so is a `rest-api` that named one.
	constructs: [
		'./constructs/**/*.ts',
		'./apps/*/{endpoints,queues,subscribers,crons,functions}/**/*.ts',
	],

	// Read from the environment rather than written down, for the reason
	// `sst.config.ts` reads its sending identity that way: an endpoint and a
	// domain are one person's infrastructure, and a literal here would be that
	// person's server baked into everybody's example.
	//
	// Omitted entirely when unset, rather than passed as an empty string — the
	// workspace schema validates the endpoint as a URL, so `''` fails to load
	// the config at all, and `gkm dev` should not need a deploy target.
	...(process.env.DOKPLOY_ENDPOINT
		? { domains: { production: process.env.KITCHEN_SINK_DOMAIN ?? '' } }
		: {}),
	deploy: {
		default: 'dokploy',
		// Where each deployed stage's telemetry goes. Dokploy runs no collector
		// of its own, so a stage there names one — `{ provider: 'otlp',
		// endpoint }` — or sends nothing. Locally `gkm dev` ignores this and
		// runs OpenObserve.
		telemetry: { production: false },
		...(process.env.DOKPLOY_ENDPOINT
			? {
					registry: 'ghcr.io/technanimals',
					dokploy: {
						endpoint: process.env.DOKPLOY_ENDPOINT,
					},
				}
			: {}),
	},
});
