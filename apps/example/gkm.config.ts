import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
	// One glob, every kind. What reconcile reads to derive the containers this
	// app needs: the `Example` database is why a Postgres exists at all, so
	// nothing lists `postgres` anywhere.
	constructs: './src/constructs/**/*.ts',
	routes: './src/endpoints/**/*.ts',
	subscribers: './src/subscribers/**/*.ts',
	envParser: './src/config/env#envParser',
	logger: './src/config/logger',
	telescope: './src/config/telescope#telescope',
	studio: './src/config/studio#studio',
	hooks: {
		server: './src/config/hooks',
	},
	runtime: 'node',
	env: ['.env', '.env.example'],
	openapi: true,
	docker: {
		registry: 'ghcr.io/technanimals',
		imageName: 'example-api',
		compose: {
			services: {
				// Deploy-side only. Locally this is ignored rather than obeyed —
				// the `Example` construct is what implies a Postgres — but the
				// Dokploy target still provisions from here until deploy derives
				// from the manifest too.
				postgres: true,
			},
		},
	},
	providers: {
		dokploy: {
			endpoint: 'https://prod.traflabs.io',
			projectId: '_ojtF2yy4hNMH11Y3hasi',
			applicationId: '5sEnezwz_AXyMEKXSYFUn',
		},
		aws: {
			apiGateway: {
				v2: true,
			},
			lambda: {
				functions: true,
				crons: true,
			},
		},
		server: true,
	},
});
