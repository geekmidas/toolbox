import { defineConfig } from '@geekmidas/cli/config';

/**
 * Kitchen-sink config — registers every construct type the toolbox supports so
 * `gkm dev` / `gkm build` discover them:
 *
 * - `routes`      → HTTP endpoints (`e`)            — Hono locally, API Gateway deployed
 * - `functions`   → standalone functions (`f`)      — invoked directly / Lambda
 * - `crons`       → scheduled tasks (`c`)           — EventBridge schedule deployed
 * - `subscribers` → topic fan-out workers (`s`)     — SNS deployed, pg-boss poller locally
 * - `queues`      → point-to-point workers (`q`)    — SQS deployed, pg-boss poller locally
 *
 * Subscribers and queues are background workers, not HTTP routes — locally they
 * poll pg-boss in-process alongside the Hono server.
 */
export default defineConfig({
	routes: './src/endpoints/**/*.ts',
	functions: './src/functions/**/*.ts',
	crons: './src/crons/**/*.ts',
	subscribers: './src/subscribers/**/*.ts',
	queues: './src/queues/**/*.ts',

	envParser: './src/config/env#envParser',
	logger: './src/config/logger',

	// Dev tooling
	telescope: './src/config/telescope#telescope',
	studio: './src/config/studio#studio',
	openapi: true,
	hooks: {
		server: './src/config/hooks',
	},

	runtime: 'node',
	env: ['.env', '.env.example'],

	docker: {
		registry: 'ghcr.io/technanimals',
		imageName: 'kitchen-sink',
		compose: {
			services: {
				// pg-boss reuses this Postgres for events/queues (dedicated schema).
				postgres: true,
			},
		},
	},

	providers: {
		aws: {
			apiGateway: { v2: true },
			lambda: { functions: true, crons: true },
		},
		server: true,
	},
});
