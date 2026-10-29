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
	composeStack,
	nestedStageLabels,
	stackPlan,
	WildcardSiteCertificateMissing,
} from '../stack';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

/**
 * A wildcard site on a deployed compose stage: every label under the
 * stage's domain that nothing else answers, on either proxy, with the
 * certificate each can have for them.
 */

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let runnables: Record<string, string[]>;
let background: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-wildcard-'));
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
	({ workspace, manifest, runnables, background } = await loadComposeApp(dir));
});

afterAll(async () => {
	await cleanupDir(dir);
});

const HOSTS_PATH = '/tenants/hosts';

/** The fixture's site, answering on every subdomain and checked by the API. */
function wildcardManifest(hosts = true): ConstructManifest {
	return {
		...manifest,
		Web: {
			...manifest.Web,
			subdomain: '*',
			...(hosts ? { hosts: { surface: 'Api', path: HOSTS_PATH } } : {}),
		},
	} as ConstructManifest;
}

function deployed(
	options: {
		proxy?: 'caddy' | 'traefik';
		route53?: boolean;
		tls?: boolean;
		hosts?: boolean;
	} = {},
) {
	const ws: NormalizedWorkspace = {
		...workspace,
		domains: {
			production: 'shop.example.com',
			staging: 'staging.shop.example.com',
		},
		protectedSubdomains: ['www', 'mail'],
		...(options.route53
			? { dns: { 'example.com': { provider: 'route53' } } }
			: {}),
		deploy: {
			...workspace.deploy,
			compose: {
				...workspace.deploy?.compose,
				...(options.proxy ? { proxy: options.proxy } : {}),
				...(options.tls
					? {
							tls: {
								production: {
									certFile: 'certs/wildcard.pem',
									keyFile: 'certs/wildcard.key',
								},
							},
						}
					: {}),
			},
		},
	};
	return composeStack({
		workspace: ws,
		manifest: wildcardManifest(options.hosts ?? true),
		runnables,
		background,
		stage: 'production',
		identity: deployIdentity(ws, 'production'),
		images: { mode: 'pull', tag: 'v1.4.0' },
		secrets: {
			...initStageSecrets('production'),
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

describe('a wildcard site behind the shared Traefik edge', () => {
	it('answers one label under the domain, below every named host', () => {
		const s = deployed({ proxy: 'traefik', route53: true });
		const routers = parse(s.traefik!).http.routers;
		const web = routers[`${s.project}-web`];

		expect(web.rule).toMatch(
			/^HostRegexp\(`\^\[a-z0-9-\]\+\\\.shop\\\.example\\\.com\$`\)/,
		);
		expect(web.priority).toBe(1);
		// The named hosts keep their own routers, at Traefik's default priority.
		expect(routers[`${s.project}-api`].rule).toBe(
			'Host(`api.shop.example.com`)',
		);
		expect(routers[`${s.project}-api`].priority).toBeUndefined();
	});

	it('never takes a protected label, nor the label of a stage under it', () => {
		const s = deployed({ proxy: 'traefik', route53: true });
		const { rule } = parse(s.traefik!).http.routers[`${s.project}-web`];

		for (const label of ['www', 'mail', 'staging', 'api', 'auth']) {
			expect(rule).toContain(`!Host(\`${label}.shop.example.com\`)`);
		}
	});

	it('gets one *.<domain> certificate over the DNS challenge when Route 53 holds the domain', () => {
		const s = deployed({ proxy: 'traefik', route53: true });
		const routers = parse(s.traefik!).http.routers;

		expect(routers[`${s.project}-web`].tls).toEqual({
			certResolver: 'letsencrypt-dns',
			domains: [{ main: '*.shop.example.com' }],
		});
		// Every other host keeps its HTTP-challenge certificate.
		expect(routers[`${s.project}-api`].tls).toEqual({
			certResolver: 'letsencrypt',
		});
		expect(s.wildcard).toEqual({
			site: 'Web',
			host: '*.shop.example.com',
			tls: 'dns',
		});
	});

	it("serves the stage's own certificate where it set one", () => {
		const s = deployed({ proxy: 'traefik', tls: true });
		const parsed = parse(s.traefik!);

		expect(parsed.http.routers[`${s.project}-web`].tls).toEqual({});
		expect(parsed.tls.certificates).toHaveLength(1);
		expect(s.wildcard?.tls).toBe('stage');
	});

	it('refuses a stage with neither, naming both', () => {
		expect(() => deployed({ proxy: 'traefik' })).toThrow(
			WildcardSiteCertificateMissing,
		);
		expect(() => deployed({ proxy: 'traefik' })).toThrow(
			/deploy\.compose\.tls.*provider: 'route53'/,
		);
	});
});

describe("a wildcard site behind the stack's own Caddy", () => {
	it('gets a certificate per tenant on demand, once its hosts route says so', () => {
		const s = deployed({ proxy: 'caddy' });
		const api = s.apps.find((a) => a.name === 'api')!;

		expect(s.caddyfile).toContain(
			`on_demand_tls {\n\t\task http://api:${api.port}${HOSTS_PATH}\n\t}`,
		);
		const block = s.caddyfile!.slice(
			s.caddyfile!.indexOf('https://*.shop.example.com {'),
		);
		expect(block).toContain('tls {\n\t\ton_demand\n\t}');
		expect(s.wildcard?.tls).toBe('on-demand');
	});

	it('is the last block, and answers no protected label', () => {
		const s = deployed({ proxy: 'caddy' });
		const caddyfile = s.caddyfile!;
		const wildcard = caddyfile.indexOf('https://*.shop.example.com {');

		expect(wildcard).toBeGreaterThan(
			caddyfile.lastIndexOf('https://api.shop.example.com {'),
		);
		const line = caddyfile
			.slice(wildcard)
			.split('\n')
			.find((l) => l.includes('@protected host'));
		for (const label of ['www', 'mail', 'staging']) {
			expect(line).toContain(`${label}.shop.example.com`);
		}
		expect(caddyfile.slice(wildcard)).toContain('respond @protected 404');
	});

	it("serves the stage's own certificate where it set one", () => {
		const s = deployed({ proxy: 'caddy', tls: true, hosts: false });
		const block = s.caddyfile!.slice(
			s.caddyfile!.indexOf('https://*.shop.example.com {'),
		);

		expect(block).toContain(
			'tls /etc/caddy/tls/cert.pem /etc/caddy/tls/key.pem',
		);
		expect(s.caddyfile).not.toContain('on_demand');
	});

	it('refuses a site without hosts and a stage without a certificate', () => {
		expect(() => deployed({ proxy: 'caddy', hosts: false })).toThrow(
			WildcardSiteCertificateMissing,
		);
		expect(() => deployed({ proxy: 'caddy', hosts: false })).toThrow(
			/deploy\.compose\.tls.*`hosts`/,
		);
	});
});

describe('the labels a stage protects', () => {
	it('include each stage whose domain sits under it', () => {
		expect(
			nestedStageLabels(
				{
					production: 'example.com',
					staging: 'staging.example.com',
					preview: 'a.preview.example.com',
					other: 'example.org',
				},
				'production',
			),
		).toEqual(['preview', 'staging']);
		expect(
			nestedStageLabels(
				{ production: 'example.com', staging: 'staging.example.com' },
				'staging',
			),
		).toEqual([]);
	});

	it("reach the site's protected subdomains, so no tenant can take one", () => {
		const plan = stackPlan(
			{
				...workspace,
				domains: {
					production: 'shop.example.com',
					staging: 'staging.shop.example.com',
				},
				protectedSubdomains: ['www'],
			},
			wildcardManifest(),
			'production',
		);
		const web = plan.resources.find((r) => r.id === 'Web');

		expect(web?.protectedSubdomains).toEqual(
			expect.arrayContaining(['www', 'staging', 'api']),
		);
	});
});
