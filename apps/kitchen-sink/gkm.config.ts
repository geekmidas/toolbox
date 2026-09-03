import { defineConfig } from '@geekmidas/cli/config';

/**
 * Kitchen-sink config.
 *
 * `constructs` is the glob the *local target* reads: every declaration found
 * under it decides which containers exist, what is created inside them, and
 * which URLs are injected. A database implies Postgres, a bucket implies MinIO,
 * mail implies Mailpit, and a queue or topic implies whichever broker the
 * project selected — pg-boss by default, which lives in the database already
 * declared. Nothing in this file lists a service.
 *
 * `src/config/**` is deliberately outside it: discovery imports what it finds,
 * and those modules resolve injected URLs at import time — which is only
 * possible after discovery has run.
 *
 * The per-kind globs below are a different question — not *what exists* but
 * *what to generate handlers for*:
 *
 * - `routes`      → HTTP endpoints (`e`)            — Hono locally, API Gateway deployed
 * - `functions`   → standalone functions (`f`)      — invoked directly / Lambda
 * - `crons`       → scheduled tasks (`c`)           — EventBridge schedule deployed
 * - `subscribers` → topic fan-out workers (`s`)     — SNS deployed, pg-boss poller locally
 * - `queues`      → point-to-point workers (`q`)    — SQS deployed, pg-boss poller locally
 * - `topics`      → the topics themselves (`t`)     — SNS topics deployed
 */
export default defineConfig({
	constructs:
		'./src/{constructs,crons,endpoints,functions,queues,subscribers}/**/*.ts',

	routes: './src/endpoints/**/*.ts',
	functions: './src/functions/**/*.ts',
	crons: './src/crons/**/*.ts',
	subscribers: './src/subscribers/**/*.ts',
	queues: './src/queues/**/*.ts',
	topics: './src/constructs/**/*.ts',

	envParser: './src/config/env#envParser',
	logger: './src/config/logger',

	// Dev tooling
	telescope: './src/config/telescope#telescope',
	studio: './src/config/studio#studio',
	openapi: true,
	hooks: {
		server: './src/config/hooks',
	},

	// Where the backends that are genuinely deployment choices resolve to.
	//
	// There is no `cache` here any more: this app declares `database.cache(...)`,
	// which says where its cache lives in the graph rather than in config. A
	// backend name is for a cache that named nowhere — and naming nowhere is what
	// forces every reader to guess which database was meant.
	services: {
		mail: 'ses',
	},

	runtime: 'node',
	env: ['.env', '.env.example'],

	docker: {
		registry: 'ghcr.io/technanimals',
		imageName: 'kitchen-sink',
	},

	providers: {
		aws: {
			apiGateway: { v2: true },
			lambda: { functions: true, crons: true },
		},
		server: true,
	},
});
