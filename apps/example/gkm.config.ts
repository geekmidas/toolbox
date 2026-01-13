import { defineConfig } from '@geekmidas/cli/config';

export default defineConfig({
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
