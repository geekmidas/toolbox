import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { derivedApps } from '../derive';
import type { NormalizedWorkspace } from '../types';

const workspace = (
	apps: Record<string, unknown> = {},
	deploy?: Record<string, unknown>,
): NormalizedWorkspace =>
	({
		name: 'shop',
		root: '/tmp/shop',
		apps,
		...(deploy ? { deploy } : {}),
		shared: { packages: [] },
		secrets: {},
	}) as unknown as NormalizedWorkspace;

const site = (id: string, app: Record<string, unknown>, extra = {}) => ({
	kind: 'site',
	id,
	variant: 'static',
	app,
	dependencies: [],
	...extra,
});

describe('derivedApps, what an app carries over', () => {
	it("keeps every setting a site's app spec gives", () => {
		const apps = derivedApps(
			{
				Web: site('Web', {
					path: 'apps/web',
					config: { client: './src/config/client.ts' },
					studio: true,
					openapi: false,
					runtime: 'bun',
					env: ['.env.web'],
					entry: './src/server.ts',
				}),
			} as unknown as ConstructManifest,
			workspace(),
		);

		expect(apps.web).toMatchObject({
			config: { client: './src/config/client.ts' },
			studio: true,
			openapi: false,
			runtime: 'bun',
			env: ['.env.web'],
			entry: './src/server.ts',
		});
	});

	it('takes the domain from config, and the target from the default', () => {
		const apps = derivedApps(
			{
				Web: site('Web', { path: 'apps/web' }),
			} as unknown as ConstructManifest,
			workspace(
				{ web: { domain: { production: 'shop.example.com' } } },
				{ default: 'vercel' },
			),
		);

		expect(apps.web?.domain).toEqual({ production: 'shop.example.com' });
		expect(apps.web?.resolvedDeployTarget).toBe('vercel');
	});

	it('deploys to Dokploy when no default is configured', () => {
		const apps = derivedApps(
			{
				Web: site('Web', { path: 'apps/web' }),
			} as unknown as ConstructManifest,
			workspace(),
		);

		expect(apps.web?.resolvedDeployTarget).toBe('dokploy');
	});

	it('orders only by edges to a surface that has an app', () => {
		const apps = derivedApps(
			{
				Web: site(
					'Web',
					{ path: 'apps/web' },
					{
						dependencies: [
							// A database is a resource, not an app to build first.
							{ target: 'Orders', kind: 'database' },
							// A surface nothing declares serves no one.
							{ target: 'Ghost', kind: 'rest-api' },
						],
					},
				),
				Orders: { kind: 'database', id: 'Orders' },
			} as unknown as ConstructManifest,
			workspace(),
		);

		expect(apps.web?.dependencies).toEqual([]);
	});

	it('gives the base domain to the only site, and ports backends first', () => {
		const apps = derivedApps(
			{
				Storefront: site('Storefront', { path: 'apps/storefront' }),
				Api: {
					kind: 'rest-api',
					id: 'Api',
					path: 'apps/api',
					endpoints: [],
				},
			} as unknown as ConstructManifest,
			workspace({
				mobile: {
					type: 'mobile',
					path: 'apps/mobile',
					port: 0,
					dependencies: [],
				},
			}),
		);

		expect(apps.storefront?.root).toBe(true);
		expect(apps.api!.port).toBeLessThan(apps.storefront!.port);
	});
});
