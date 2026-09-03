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
	//
	// `events` is the opposite case, and belongs here: a queue and a topic are
	// declared in code, but *what carries them* is a deployment choice, and the
	// same handlers drain pg-boss locally and SQS deployed. Reading it from the
	// environment is what lets the same suite run over both — `pnpm test` on
	// pg-boss, `pnpm test:sns` on SNS and SQS against the local AWS emulator —
	// which is the only way "the transport is chosen by the connection string"
	// gets tested rather than asserted.
	services: {
		mail: 'ses',
		events:
			(process.env.KITCHEN_SINK_EVENTS as 'pgboss' | 'sns' | 'rabbitmq') ??
			'pgboss',
	},

	runtime: 'node',
	env: ['.env', '.env.example'],

	docker: {
		registry: 'ghcr.io/technanimals',
		imageName: 'kitchen-sink',
	},

	// Where this deploys, when it deploys.
	//
	// Read from the environment rather than written down, for the same reason
	// `sst.config.ts` reads its sending identity that way: an endpoint and a
	// domain name one person's server, and a literal here would be that person's
	// infrastructure baked into everybody's example. Unset, the deploy says what
	// is missing and names the stage.
	deploy: {
		default: 'dokploy',
		dokploy: {
			endpoint: process.env.DOKPLOY_ENDPOINT ?? '',
			registry: 'ghcr.io/technanimals',
			domains: { prod: process.env.KITCHEN_SINK_DOMAIN ?? '' },
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
