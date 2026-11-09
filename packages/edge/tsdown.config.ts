import { defineConfig } from 'tsdown';

export default defineConfig({
	// Explicit, so each DNS provider is an entry of its own: a workspace that
	// writes its records through Hostinger never resolves the AWS SDK that
	// Route 53's entry imports.
	entry: [
		'src/index.ts',
		'src/routes/index.ts',
		'src/proxy/caddy.ts',
		'src/proxy/traefik.ts',
		'src/certificates/local.ts',
		'src/dns/index.ts',
		'src/dns/route53.ts',
		'src/dns/hostinger/index.ts',
		'src/dns/godaddy/index.ts',
	],
	deps: {
		neverBundle: ['@aws-sdk/client-route-53', '@aws-sdk/credential-providers'],
	},
});
