import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { hostsFor, sitesFor, toCaddyfile } from '../caddyfile';
import { portKeys, primaryPortKey } from '../containers';
import { envFor } from '../env';
import { planFor } from '../plan';
import { TEST_CREDENTIALS } from './__helpers__/credentials';

/**
 * Aliases and redirects under `gkm dev`'s edge: labels under the project,
 * carrying the stage as a construct's own label does, answered by the same
 * Caddy block — and a site's aliases trusted by the surfaces it calls.
 */

const manifest = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: 'apps/api',
		aliases: ['rest'],
		endpoints: [],
		provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
	},
	Web: {
		kind: 'site',
		id: 'Web',
		variant: 'static',
		aliases: ['store'],
		redirects: ['www'],
		app: { path: 'apps/web' },
		dependencies: [{ target: 'Api', kind: 'rest-api' }],
		provides: ['WEB_URL'],
	},
} as const satisfies ConstructManifest;

const addresses = {
	Api: 'http://localhost:3000',
	Web: 'http://localhost:3001',
};

function resolve(stage = 'dev') {
	const plan = planFor(manifest, stage, provisionOrder(manifest), {
		localStage: 'dev',
	});
	const ports = Object.fromEntries(
		portKeys(plan.containers).map((key, i) => [key, 22000 + i]),
	);
	const env = envFor(plan, {
		credentials: TEST_CREDENTIALS,
		ports,
		project: 'shop',
		addresses,
	});
	return { plan, env, edge: ports[primaryPortKey('caddy')]! };
}

describe('aliases and redirects, locally', () => {
	it('are labels under the project, the stage kept as a suffix', () => {
		const dev = resolve().plan.resources;
		const api = dev.find((r) => r.id === 'Api')!;
		const web = dev.find((r) => r.id === 'Web')!;

		expect(hostsFor(api, 'shop')).toEqual({
			host: 'api.shop.localhost',
			aliases: ['rest.shop.localhost'],
			redirects: [],
		});
		expect(hostsFor(web, 'shop')).toEqual({
			host: 'shop.localhost',
			aliases: ['store.shop.localhost'],
			redirects: ['www.shop.localhost'],
		});

		const test = resolve('test').plan.resources.find((r) => r.id === 'Web')!;
		expect(hostsFor(test, 'shop').redirects).toEqual([
			'www-test.shop.localhost',
		]);
	});

	it('keep the primary host canonical', () => {
		const { env, edge } = resolve();

		expect(env.API_URL).toBe(`https://api.shop.localhost:${edge}`);
		expect(env.WEB_URL).toBe(`https://shop.localhost:${edge}`);
	});

	it('serve aliases from the site block and redirect to the canonical host', () => {
		const { plan, edge } = resolve();
		const caddyfile = toCaddyfile(sitesFor(plan, 'shop', addresses), {
			certificate: '/etc/caddy/sites/dev.pem',
			port: edge,
		});

		expect(caddyfile).toContain(
			'https://api.shop.localhost, https://rest.shop.localhost {',
		);
		expect(caddyfile).toContain(
			'https://shop.localhost, https://store.shop.localhost {',
		);
		expect(caddyfile).toContain(
			`redir https://shop.localhost:${edge}{uri} permanent`,
		);
		expect(caddyfile).toMatch(/https:\/\/www\.shop\.localhost \{\n\ttls /);
	});

	it("trust a site's aliases on the surfaces it calls, and never its redirects", () => {
		const { env, edge } = resolve();
		const origins = env.API_TRUSTED_ORIGINS!.split(',');

		expect(origins).toEqual([
			`https://shop.localhost:${edge}`,
			`https://store.shop.localhost:${edge}`,
		]);
	});
});
