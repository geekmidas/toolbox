import { RandomPassword } from '@geekmidas/constructs/random-password';
import { StaticSite } from '@geekmidas/constructs/site';
import type { ConstructManifest, SiteDeclaration } from '@geekmidas/manifest';
import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { edgeCaddyfile } from '../caddyfile';
import type { EdgeRoute } from '../routes';
import {
	assertSitePasswords,
	SitePasswordMissing,
	SitePasswordNeedsCompose,
	SitePasswordNotDeclared,
	siteAuth,
	sitePasswordKey,
	UnknownPasswordStage,
} from '../sitePassword';
import { traefikDynamic } from '../traefik';

const sitePassword = new RandomPassword('SitePassword');
const guarded = new StaticSite('Web', {
	path: 'apps/web',
	password: { secret: sitePassword, stages: ['staging'] },
});
const manifestOf = (
	...constructs: { declare(): readonly { id: string }[] }[]
): ConstructManifest =>
	Object.fromEntries(
		constructs.flatMap((c) => c.declare()).map((d) => [d.id, d]),
	) as ConstructManifest;
const manifest = manifestOf(sitePassword, guarded);
const site = manifest.Web as SiteDeclaration;
const workspace = {
	stages: { local: 'development', deployed: ['staging', 'production'] },
};

describe('the password a site is served behind', () => {
	it("is its RandomPassword's key, on the stages it names", () => {
		expect(sitePasswordKey(manifest, site, 'staging')).toBe('SITE_PASSWORD');
		expect(sitePasswordKey(manifest, site, 'production')).toBeUndefined();
	});

	it('is refused where the RandomPassword was not exported', () => {
		expect(() => sitePasswordKey(manifestOf(guarded), site, 'staging')).toThrow(
			SitePasswordNotDeclared,
		);
		expect(() => sitePasswordKey(manifestOf(guarded), site, 'staging')).toThrow(
			"export const sitePassword = new RandomPassword('SitePassword')",
		);
	});
});

describe('a site behind a password, before a deploy', () => {
	it('is refused on another target, rather than deployed in public', () => {
		expect(() =>
			assertSitePasswords(workspace, manifest, 'staging', ['web'], 'dokploy'),
		).toThrow(SitePasswordNeedsCompose);
		expect(() =>
			assertSitePasswords(workspace, manifest, 'staging', ['web'], 'sst'),
		).toThrow("Remove staging from its password's stages");
	});

	it('goes ahead on compose, on a stage it does not name, or without the site', () => {
		const go = (stage: string, apps: string[], target: string) => () =>
			assertSitePasswords(workspace, manifest, stage, apps, target);

		expect(go('staging', ['web'], 'compose')).not.toThrow();
		expect(go('production', ['web'], 'dokploy')).not.toThrow();
		expect(go('staging', ['api'], 'dokploy')).not.toThrow();
	});

	it('refuses a stage the workspace does not deploy', () => {
		const typo = manifestOf(
			sitePassword,
			new StaticSite('Web', {
				path: 'apps/web',
				password: { secret: sitePassword, stages: ['stagin'] },
			}),
		);

		const error = (() => {
			try {
				assertSitePasswords(workspace, typo, 'staging', ['web'], 'compose');
			} catch (caught) {
				return caught;
			}
		})();
		expect(error).toBeInstanceOf(UnknownPasswordStage);
		expect(error).toMatchObject({ site: 'Web', stage: 'stagin' });
		expect((error as Error).message).toContain("'staging', 'production'");
	});
});

describe("a site's login", () => {
	it("is the stage's name and its password, with only a bcrypt hash for the edge", () => {
		const auth = siteAuth('staging', 'SITE_PASSWORD', {
			SITE_PASSWORD: 'open sesame',
		});

		expect(auth).toMatchObject({
			user: 'staging',
			password: 'open sesame',
			key: 'SITE_PASSWORD',
		});
		expect(auth.hash).toMatch(/^\$2a\$10\$/);
		expect(bcrypt.compareSync('open sesame', auth.hash)).toBe(true);
		expect(bcrypt.compareSync('open says me', auth.hash)).toBe(false);
	});

	it('hashes the same password the same way, so an unchanged deploy rewrites nothing', () => {
		const custom = { SITE_PASSWORD: 'open sesame' };

		expect(siteAuth('staging', 'SITE_PASSWORD', custom).hash).toBe(
			siteAuth('staging', 'SITE_PASSWORD', custom).hash,
		);
		expect(siteAuth('staging', 'SITE_PASSWORD', custom).hash).not.toBe(
			siteAuth('staging', 'SITE_PASSWORD', { SITE_PASSWORD: 'another' }).hash,
		);
	});

	it('is refused where the stage holds none, naming the secret', () => {
		expect(() => siteAuth('staging', 'SITE_PASSWORD', {})).toThrow(
			SitePasswordMissing,
		);
		expect(() => siteAuth('staging', 'SITE_PASSWORD', {})).toThrow(
			"gkm secrets:set SITE_PASSWORD '…' --stage staging",
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
