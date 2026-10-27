import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { hostFor, sitesFor, toCaddyfile } from '../caddyfile';
import { portKeys, primaryPortKey } from '../containers';
import { envFor } from '../env';
import { planFor } from '../plan';
import { TEST_CREDENTIALS } from './__helpers__/credentials';

/**
 * A site on every subdomain, locally: one host per tenant under the stage's
 * own domain, and the surfaces it calls trusting all of them.
 */

const manifest = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		endpoints: [
			{
				method: 'GET',
				path: '/tenants/hosts',
				handler: 'src/hosts.ts#hosts',
				dependencies: [],
			},
		],
		provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
	},
	App: {
		kind: 'site',
		id: 'App',
		variant: 'next',
		subdomain: '*',
		hosts: { surface: 'Api', path: '/tenants/hosts' },
		app: { path: 'apps/app' },
		dependencies: [{ target: 'Api', kind: 'rest-api' }],
		provides: ['APP_URL', 'APP_DOMAIN', 'APP_PROTECTED_SUBDOMAINS'],
	},
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'static',
		app: { path: 'apps/web' },
		dependencies: [],
		provides: ['WEB_URL'],
	},
} as const satisfies ConstructManifest;

function resolve(stage = 'dev') {
	const plan = planFor(manifest, stage, provisionOrder(manifest), {
		localStage: 'dev',
		protectedSubdomains: ['www', 'status'],
	});
	const ports = Object.fromEntries(
		portKeys(plan.containers).map((key, i) => [key, 21000 + i]),
	);
	const env = envFor(plan, {
		credentials: TEST_CREDENTIALS,
		ports,
		project: 'shop',
		addresses: {
			Api: 'http://localhost:3000',
			App: 'http://localhost:3001',
			Web: 'http://localhost:3002',
		},
	});
	return { plan, env, edge: ports[primaryPortKey('caddy')] };
}

describe('a wildcard site, locally', () => {
	it('answers on every label under the project, and the stage as one', () => {
		const { plan, env, edge } = resolve();
		const app = plan.resources.find((r) => r.id === 'App')!;

		expect(hostFor(app, 'shop')).toBe('*.shop.localhost');
		expect(env.APP_URL).toBe(`https://*.shop.localhost:${edge}`);

		const test = resolve('test').plan.resources.find((r) => r.id === 'App')!;
		expect(hostFor(test, 'shop')).toBe('*.test.shop.localhost');
	});

	it('is a site block of its own on the dev edge', () => {
		const { plan } = resolve();
		const caddyfile = toCaddyfile(
			sitesFor(plan, 'shop', {
				Api: 'http://localhost:3000',
				App: 'http://localhost:3001',
			}),
		);

		expect(caddyfile).toContain('*.shop.localhost');
		expect(caddyfile).toContain('api.shop.localhost');
	});

	it('never holds the base domain, so the other site does', () => {
		const { plan } = resolve();

		expect(plan.resources.find((r) => r.id === 'App')?.root).toBeUndefined();
		expect(plan.resources.find((r) => r.id === 'Web')?.root).toBe(true);
	});

	it('is handed the domain its tenants sit under, inlined for its bundle', () => {
		const { env } = resolve();

		expect(env.APP_DOMAIN).toBe('shop.localhost');
		expect(env.NEXT_PUBLIC_APP_DOMAIN).toBe('shop.localhost');
		expect(resolve('test').env.APP_DOMAIN).toBe('test.shop.localhost');
	});

	it('is handed every label no tenant may take', () => {
		const { env } = resolve();

		// The API's own, every site's, and the workspace's own list.
		expect(env.APP_PROTECTED_SUBDOMAINS).toBe('api,status,web,www');
		expect(env.NEXT_PUBLIC_APP_PROTECTED_SUBDOMAINS).toBe('api,status,web,www');
	});

	it('puts every tenant on the trusted origins of what it calls', () => {
		const { env, edge } = resolve();

		expect(env.API_TRUSTED_ORIGINS).toBe(`https://*.shop.localhost:${edge}`);
		// One parent for the API and every tenant: the session cookie is
		// readable on each tenant's host.
		expect(env.API_COOKIE_DOMAIN).toBe('.shop.localhost');
	});
});
