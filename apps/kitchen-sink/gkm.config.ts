import { defineWorkspace } from '@geekmidas/cli/config';

/**
 * kitchen-sink, as a workspace.
 *
 * The shape a real product has, and the reason it changed: constructs used to
 * live inside the API app, which meant `site.ts` declared
 * `path: '../kitchen-sink-web'` — a construct escaping its own app to point at
 * a sibling. That only worked because one app was quietly acting as the
 * workspace root while also being an app.
 *
 * Now there is a root. Infrastructure is declared once at the top, every app
 * resolves it through `@kitchen-sink/constructs` (mapped in `tsconfig.json`),
 * and an app's path is relative to something that exists.
 *
 * `constructs` here is the workspace's own glob — one place for the product's
 * infrastructure. Apps may still carry their own for something only they use;
 * the two are additive.
 */
export default defineWorkspace({
	// The scope every physical name is built from: `Database` becomes
	// `production-kitchen-sink-database` on Dokploy and on AWS alike.
	name: 'kitchen-sink',

	// One glob, every kind. A database implies Postgres, a bucket implies MinIO,
	// mail implies Mailpit — none of it listed anywhere.
	constructs: './constructs/**/*.ts',

	apps: {
		api: {
			type: 'backend',
			path: 'apps/api',
			port: 3000,
			dependencies: [],

			routes: './endpoints/**/*.ts',
			functions: './functions/**/*.ts',
			crons: './crons/**/*.ts',
			subscribers: './subscribers/**/*.ts',
			queues: './queues/**/*.ts',

			envParser: './config/env#envParser',
			logger: './config/logger',
			telescope: './config/telescope#telescope',
			studio: './config/studio#studio',
			openapi: true,
			runtime: 'node',
			env: ['.env', '.env.example'],
		},

		// Two sites, two variants — which is the only way the variant selection
		// is proven rather than asserted: `web` builds to files behind nginx,
		// `admin` to a Node process. `web` holds the base domain by convention;
		// `admin` gets `admin.` from its construct id.
		web: {
			type: 'web',
			path: 'apps/web',
			port: 3001,
			framework: 'vite',
			dependencies: ['api'],
		},
		admin: {
			type: 'web',
			path: 'apps/admin',
			port: 3002,
			framework: 'nextjs',
			dependencies: ['api'],
		},
	},

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
