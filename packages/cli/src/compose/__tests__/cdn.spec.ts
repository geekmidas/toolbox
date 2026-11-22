import { realpathSync } from 'node:fs';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { deployIdentity } from '../../deploy/identity';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { initStageSecrets } from '../../secrets/storage';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	CdnCertificateUnavailable,
	CdnConfigInvalid,
	CdnNeedsCloudflareDns,
	CdnNeedsDomain,
	checkStageCdn,
	stageCdn,
} from '../cdn';
import { diffDomainDns, planStackDns } from '../dns';
import { composeStack } from '../stack';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

/**
 * `deploy.cdn`: Cloudflare in front of a compose stage's sites — which hosts
 * it answers, how their certificates are had, and the records written.
 */

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let background: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-cdn-'));
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
	({ workspace, manifest, background } = await loadComposeApp(dir));
});

afterAll(async () => {
	await cleanupDir(dir);
});

/** The fixture's workspace with a CDN on production, through `dns`. */
function withCdn(
	options: {
		proxy?: 'caddy' | 'traefik';
		dns?: string;
		tls?: boolean;
		cdn?: unknown;
	} = {},
): NormalizedWorkspace {
	return {
		...workspace,
		domains: { production: 'shop.example.com' },
		dns: {
			'example.com': { provider: options.dns ?? 'cloudflare' } as never,
		},
		deploy: {
			...workspace.deploy,
			cdn: {
				production: (options.cdn ?? { provider: 'cloudflare' }) as never,
			},
			compose: {
				...workspace.deploy?.compose,
				proxy: options.proxy ?? 'traefik',
				...(options.tls
					? {
							tls: {
								production: {
									certFile: 'certs/origin.pem',
									keyFile: 'certs/origin.key',
								},
							},
						}
					: {}),
			},
		},
	};
}

function stack(ws: NormalizedWorkspace, stage = 'production') {
	return composeStack({
		workspace: ws,
		manifest,
		background,
		stage,
		identity: deployIdentity(ws, stage),
		images: { mode: 'pull', tag: 'v1.4.0' },
		secrets: {
			...initStageSecrets(stage),
			seed: 'a-random-seed',
			custom: {
				AUTH_SECRET: 'the-production-signing-secret',
				REDIS_PASSWORD: 'the-redis-password',
			},
		},
		ports: {},
		localCredentials: TEST_CREDENTIALS,
	});
}

describe('checkStageCdn', () => {
	it.each([
		[false, false],
		[{ provider: 'cloudflare' }, { provider: 'cloudflare' }],
	])('takes %j', (value, expected) => {
		expect(checkStageCdn('production', value)).toEqual(expected);
	});

	it.each([
		[{ provider: 'fastly' }],
		[{ provider: 'cloudflare', cache: true }],
		[true],
		['cloudflare'],
	])('refuses %j, by name', (value) => {
		expect(() => checkStageCdn('production', value)).toThrow(CdnConfigInvalid);
	});
});

describe('stageCdn', () => {
	it('is the provider and the zone holding the stage’s domain', () => {
		expect(stageCdn(withCdn(), 'production')).toEqual({
			provider: 'cloudflare',
			domain: 'shop.example.com',
			zone: 'example.com',
		});
	});

	it('is nothing for a stage the map leaves out, or sets false', () => {
		expect(stageCdn(withCdn(), 'staging')).toBeUndefined();
		expect(stageCdn(withCdn({ cdn: false }), 'production')).toBeUndefined();
	});

	it('needs the stage to have a domain', () => {
		const ws = { ...withCdn(), domains: {} };

		expect(() => stageCdn(ws, 'production')).toThrow(CdnNeedsDomain);
	});

	it("needs Cloudflare to serve the domain's DNS, naming who does", () => {
		const error = (() => {
			try {
				stageCdn(withCdn({ dns: 'godaddy' }), 'production');
			} catch (e) {
				return e;
			}
		})();

		expect(error).toBeInstanceOf(CdnNeedsCloudflareDns);
		expect(error).toMatchObject({
			domain: 'shop.example.com',
			provider: 'godaddy',
		});
	});
});

describe('a stage behind Cloudflare, on the shared Traefik edge', () => {
	it("certifies every site host over Cloudflare's DNS challenge, and nothing else", () => {
		const s = stack(withCdn());
		const routers = parse(s.traefik!).http.routers as Record<
			string,
			{ tls: unknown }
		>;
		const sites = s.apps.filter((a) => a.kind === 'site');
		const others = s.apps.filter((a) => a.kind !== 'site');

		expect(sites.length).toBeGreaterThan(0);
		expect(others.length).toBeGreaterThan(0);
		expect(sites.map((a) => routers[`${s.project}-${a.name}`]!.tls)).toEqual(
			sites.map(() => ({ certResolver: 'letsencrypt-dns-cloudflare' })),
		);
		expect(others.map((a) => routers[`${s.project}-${a.name}`]!.tls)).toEqual(
			others.map(() => ({ certResolver: 'letsencrypt' })),
		);
	});

	it('names the hosts the CDN answers: every site host, and only those', () => {
		const s = stack(withCdn());
		const siteHosts = s.routes
			.filter((r) => s.apps.some((a) => a.kind === 'site' && a.name === r.name))
			.flatMap((r) => [r.host, ...(r.aliases ?? [])]);

		expect(s.cdn).toEqual({
			provider: 'cloudflare',
			hosts: siteHosts,
			dnsCertificates: true,
		});
		expect(s.cdn!.hosts).not.toContain('api.shop.example.com');
	});

	it("keeps the stage's own certificate where it has one", () => {
		const s = stack(withCdn({ tls: true }));
		const parsed = parse(s.traefik!);

		expect(JSON.stringify(parsed.http.routers)).not.toContain(
			'letsencrypt-dns-cloudflare',
		);
		expect(s.cdn?.dnsCertificates).toBe(false);
	});
});

describe("a stage behind Cloudflare, on the stack's own Caddy", () => {
	it('is refused without a certificate of its own', () => {
		expect(() => stack(withCdn({ proxy: 'caddy' }))).toThrow(
			CdnCertificateUnavailable,
		);
	});

	it('serves with a certificate of its own', () => {
		const s = stack(withCdn({ proxy: 'caddy', tls: true }));

		expect(s.cdn).toMatchObject({
			provider: 'cloudflare',
			dnsCertificates: false,
		});
	});
});

describe('the records a CDN stage writes', () => {
	const server = { ipv4: '203.0.113.10' };

	it('proxies the hosts the CDN answers, and says every other is not', () => {
		const plan = planStackDns({
			stage: 'production',
			hosts: ['shop.example.com', 'api.shop.example.com'],
			server,
			dns: { 'example.com': { provider: 'cloudflare' } },
			proxied: ['shop.example.com'],
		});

		expect(
			plan.domains[0]!.records.map((r) => [r.host, r.type, r.proxied]),
		).toEqual([
			['api.shop.example.com', 'A', false],
			['shop.example.com', 'A', true],
		]);
	});

	it('says nothing of a proxy under a provider without one', () => {
		const plan = planStackDns({
			stage: 'production',
			hosts: ['shop.example.com'],
			server,
			dns: { 'example.com': { provider: 'godaddy' } },
			proxied: ['shop.example.com'],
		});

		expect(plan.domains[0]!.records[0]).not.toHaveProperty('proxied');
	});

	it('updates a record whose value is right and whose proxy is not', () => {
		const plan = planStackDns({
			stage: 'production',
			hosts: ['shop.example.com'],
			server,
			dns: { 'example.com': { provider: 'cloudflare' } },
			proxied: ['shop.example.com'],
		});

		const changes = diffDomainDns(plan.domains[0]!, [
			{
				name: 'shop',
				type: 'A',
				ttl: 300,
				values: ['203.0.113.10'],
				proxied: false,
			},
		]);

		expect(changes).toEqual([
			expect.objectContaining({
				name: 'shop',
				action: 'update',
				proxied: true,
			}),
		]);
	});

	it('leaves a record whose value and proxy are right', () => {
		const plan = planStackDns({
			stage: 'production',
			hosts: ['shop.example.com'],
			server,
			dns: { 'example.com': { provider: 'cloudflare' } },
			proxied: ['shop.example.com'],
		});

		const changes = diffDomainDns(plan.domains[0]!, [
			{
				name: 'shop',
				type: 'A',
				ttl: 300,
				values: ['203.0.113.10'],
				proxied: true,
			},
		]);

		expect(changes.map((c) => c.action)).toEqual(['unchanged']);
	});
});

describe('the local stage', () => {
	it('never has a CDN', () => {
		const ws = withCdn();
		const s = stack(
			{
				...ws,
				deploy: {
					...ws.deploy,
					cdn: { [ws.stages.local]: { provider: 'cloudflare' } },
				},
			},
			ws.stages.local,
		);

		expect(s.cdn).toBeUndefined();
	});
});
