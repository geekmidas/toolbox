import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { initStageSecrets } from '../../secrets/storage';
import { safeValidateWorkspaceConfig } from '../../workspace/schema';
import { edgeCaddyfile } from '../caddyfile';
import type { EdgeRoute } from '../routes';
import {
	assertSitePasswordTarget,
	passwordSites,
	SitePasswordMissing,
	SitePasswordNeedsCompose,
	siteAuth,
	sitePasswordKey,
	UnknownPasswordSite,
	withSitePasswords,
} from '../sitePassword';
import { traefikDynamic } from '../traefik';

const SITES = ['web', 'admin'];
const workspace = (sitePassword: Record<string, true | string[]>) => ({
	deploy: { sitePassword },
});

describe('which sites a stage puts behind a password', () => {
	it('is every site for true', () => {
		expect(
			passwordSites(workspace({ staging: true }), 'staging', SITES),
		).toEqual(SITES);
	});

	it('is the sites it names, by app name or construct id', () => {
		expect(
			passwordSites(workspace({ staging: ['Admin'] }), 'staging', SITES),
		).toEqual(['admin']);
	});

	it('is none on a stage it leaves out', () => {
		expect(
			passwordSites(workspace({ staging: true }), 'production', SITES),
		).toEqual([]);
		expect(passwordSites({}, 'staging', SITES)).toEqual([]);
	});

	it('refuses a name that is not a site, listing the ones that are', () => {
		const error = (() => {
			try {
				passwordSites(workspace({ staging: ['api'] }), 'staging', SITES);
			} catch (caught) {
				return caught;
			}
		})();

		expect(error).toBeInstanceOf(UnknownPasswordSite);
		expect(error).toMatchObject({
			stage: 'staging',
			site: 'api',
			sites: SITES,
		});
		expect((error as Error).message).toContain("'web', 'admin'");
	});
});

describe('a stage behind a password, on another target', () => {
	it('is refused, rather than deployed in public', () => {
		const ws = workspace({ staging: true });

		expect(() => assertSitePasswordTarget(ws, 'staging', 'dokploy')).toThrow(
			SitePasswordNeedsCompose,
		);
		expect(() => assertSitePasswordTarget(ws, 'staging', 'sst')).toThrow(
			'Remove staging from deploy.sitePassword',
		);
		expect(() =>
			assertSitePasswordTarget(ws, 'staging', 'compose'),
		).not.toThrow();
		expect(() =>
			assertSitePasswordTarget(ws, 'production', 'dokploy'),
		).not.toThrow();
	});
});

describe("a site's password", () => {
	it('is generated once, into the stage secret named after the site', () => {
		const { secrets, generated } = withSitePasswords(
			initStageSecrets('staging'),
			['web'],
		);

		expect(generated).toEqual(['WEB_SITE_PASSWORD']);
		expect(secrets.custom.WEB_SITE_PASSWORD).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(withSitePasswords(secrets, ['web'])).toEqual({
			secrets,
			generated: [],
		});
	});

	it('keeps one set by hand', () => {
		const set = {
			...initStageSecrets('staging'),
			custom: { [sitePasswordKey('web')]: 'chosen by hand' },
		};

		expect(withSitePasswords(set, ['web']).secrets.custom).toEqual({
			WEB_SITE_PASSWORD: 'chosen by hand',
		});
	});

	it("is the stage's login, with only its bcrypt hash for the edge", () => {
		const auth = siteAuth('staging', 'web', {
			WEB_SITE_PASSWORD: 'open sesame',
		});

		expect(auth).toMatchObject({
			user: 'staging',
			password: 'open sesame',
			key: 'WEB_SITE_PASSWORD',
		});
		expect(auth.hash).toMatch(/^\$2a\$10\$/);
		expect(bcrypt.compareSync('open sesame', auth.hash)).toBe(true);
		expect(bcrypt.compareSync('open says me', auth.hash)).toBe(false);
	});

	it('hashes the same password the same way, so an unchanged deploy rewrites nothing', () => {
		const custom = { WEB_SITE_PASSWORD: 'open sesame' };

		expect(siteAuth('staging', 'web', custom).hash).toBe(
			siteAuth('staging', 'web', custom).hash,
		);
		expect(siteAuth('staging', 'web', custom).hash).not.toBe(
			siteAuth('staging', 'web', { WEB_SITE_PASSWORD: 'another' }).hash,
		);
	});

	it('is refused where the stage holds none, naming the secret', () => {
		expect(() => siteAuth('staging', 'web', {})).toThrow(SitePasswordMissing);
		expect(() => siteAuth('staging', 'web', {})).toThrow(
			"gkm secrets:set WEB_SITE_PASSWORD '…' --stage staging",
		);
	});
});

describe('the edge, for a site behind a password', () => {
	const route = (auth?: EdgeRoute['auth']): EdgeRoute => ({
		name: 'web',
		host: 'staging.shop.example.com',
		upstreams: [{ service: 'web', port: 3002 }],
		streaming: true,
		health: '/',
		...(auth ? { auth } : {}),
	});
	const login = { user: 'staging', hash: '$2a$10$abcdefghijklmnopqrstuv' };

	it('asks for the login in Caddy, on that host alone', () => {
		const caddyfile = edgeCaddyfile(
			[route(login), { ...route(), name: 'api', host: 'api.shop.example.com' }],
			{
				tls: { kind: 'acme' },
			},
		);

		expect(caddyfile).toContain(
			'\tbasic_auth {\n\t\tstaging $2a$10$abcdefghijklmnopqrstuv\n\t}',
		);
		expect(caddyfile.match(/basic_auth/g)).toHaveLength(1);
	});

	it('asks for it in Traefik with a basicAuth middleware on its router', () => {
		const { http } = traefikDynamic([route(login)], {
			project: 'shop-staging',
			tls: { kind: 'acme' },
		}) as {
			http: {
				routers: Record<string, { middlewares: string[] }>;
				middlewares: Record<string, unknown>;
			};
		};

		expect(http.routers['shop-staging-web']?.middlewares).toEqual([
			'shop-staging-strip-gkm-headers',
			'shop-staging-web-auth',
		]);
		expect(http.middlewares['shop-staging-web-auth']).toEqual({
			basicAuth: { users: ['staging:$2a$10$abcdefghijklmnopqrstuv'] },
		});
	});

	it('asks for nothing on a route without one', () => {
		expect(edgeCaddyfile([route()], { tls: { kind: 'acme' } })).not.toContain(
			'basic_auth',
		);
	});
});

describe('deploy.sitePassword in the workspace config', () => {
	const config = (sitePassword: unknown) => ({
		name: 'shop',
		stages: { local: 'development', deployed: ['staging', 'production'] },
		deploy: { sitePassword },
	});

	it('takes true or a list of sites, per deployed stage', () => {
		expect(
			safeValidateWorkspaceConfig(
				config({ staging: true, production: ['web'] }),
			).success,
		).toBe(true);
		expect(safeValidateWorkspaceConfig(config({ staging: [] })).success).toBe(
			false,
		);
		expect(
			safeValidateWorkspaceConfig(config({ staging: false })).success,
		).toBe(false);
	});

	it('refuses a stage that is not deployed, and the local one', () => {
		const typo = safeValidateWorkspaceConfig(config({ stagin: true }));
		expect(typo.error?.issues[0]?.message).toContain(
			"deploy.sitePassword names the stage 'stagin'",
		);

		const local = safeValidateWorkspaceConfig(config({ development: true }));
		expect(local.error?.issues[0]?.message).toContain('the local stage');
	});
});
