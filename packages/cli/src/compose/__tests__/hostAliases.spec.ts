import { realpathSync } from 'node:fs';
import { type ConstructManifest, EDGE_TOKEN_HEADER } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { deployIdentity } from '../../deploy/identity';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { initStageSecrets } from '../../secrets/storage';
import { localCertificateNames } from '../../trust/authority';
import type { NormalizedWorkspace } from '../../workspace/types';
import { edgeCaddyfile } from '../caddyfile';
import { planStackDns, stackHosts } from '../dns';
import type { EdgeRoute } from '../routes';
import { type ComposeStack, composeStack } from '../stack';
import {
	edgeClaims,
	readEdgeClaims,
	traefikDynamic,
	traefikDynamicFile,
} from '../traefik';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

/**
 * A surface answering on an alias and a site with an alias and a redirect,
 * on a deployed compose stage: the same hosts, checks and claims from the
 * one route model, whichever proxy renders it.
 */

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let background: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-aliases-'));
	writeComposeApp(dir, { registry: 'registry.example.com/acme' });
	({ workspace, manifest, background } = await loadComposeApp(dir));
});

afterAll(async () => {
	await cleanupDir(dir);
});

/** `rest.` beside `api.`, and the root site on `store.` too, `www.` sent to it. */
function aliasedManifest(wildcard = false): ConstructManifest {
	return {
		...manifest,
		Api: { ...manifest.Api, aliases: ['rest'] },
		Web: wildcard
			? {
					...manifest.Web,
					subdomain: '*',
					hosts: { surface: 'Api', path: '/tenants/hosts' },
				}
			: { ...manifest.Web, aliases: ['store'], redirects: ['www'] },
		...(wildcard
			? {
					Api: {
						...manifest.Api,
						aliases: ['rest'],
						endpoints: [
							...((manifest.Api as { endpoints?: unknown[] }).endpoints ?? []),
							{ method: 'GET', path: '/tenants/hosts', dependencies: [] },
						],
					},
				}
			: {}),
	} as ConstructManifest;
}

function deployed(
	options: { proxy?: 'caddy' | 'traefik'; wildcard?: boolean } = {},
): ComposeStack {
	const ws: NormalizedWorkspace = {
		...workspace,
		domains: { production: 'shop.example.com' },
		protectedSubdomains: ['mail'],
		...(options.wildcard
			? { dns: { 'example.com': { provider: 'route53' } } }
			: {}),
		deploy: {
			...workspace.deploy,
			compose: {
				...workspace.deploy?.compose,
				...(options.proxy ? { proxy: options.proxy } : {}),
			},
		},
	};
	return composeStack({
		workspace: ws,
		manifest: aliasedManifest(options.wildcard),
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

const API_HOSTS =
	'(Host(`api.shop.example.com`) || Host(`rest.shop.example.com`))';
const WEB_HOSTS =
	'(Host(`shop.example.com`) || Host(`store.shop.example.com`))';
const EVERY_HOST = [
	'api.shop.example.com',
	'rest.shop.example.com',
	'shop.example.com',
	'store.shop.example.com',
	'www.shop.example.com',
];

describe('host aliases and redirects on the stack', () => {
	it('keeps the primary host canonical: the URL is built on it alone', () => {
		const s = deployed({ proxy: 'traefik' });
		const api = s.apps.find((app) => app.id === 'Api')!;
		const web = s.apps.find((app) => app.id === 'Web')!;

		expect(api.url).toBe('https://api.shop.example.com');
		expect(api.aliases).toEqual(['rest.shop.example.com']);
		expect(web.url).toBe('https://shop.example.com');
		expect(web.aliases).toEqual(['store.shop.example.com']);
		expect(web.redirects).toEqual(['www.shop.example.com']);
	});

	it('puts every alias and redirect in the DNS plan and the certificate names', () => {
		const s = deployed({ proxy: 'traefik' });
		const hosts = stackHosts(s);
		for (const host of EVERY_HOST) expect(hosts).toContain(host);

		const plan = planStackDns({
			stage: 'production',
			hosts,
			server: { ipv4: '203.0.113.10' },
			dns: { 'shop.example.com': { provider: 'manual' } },
		});
		const named = plan.domains.flatMap((d) => d.records.map((r) => r.host));
		for (const host of EVERY_HOST) expect(named).toContain(host);

		// A local stage's certificate, from the same list.
		expect(
			localCertificateNames('', ['rest.shop.localhost', 'www.shop.localhost']),
		).toEqual(['rest.shop.localhost', 'www.shop.localhost']);
	});

	it("trusts a site's aliases on the surfaces it calls, and never its redirects", () => {
		const s = deployed({ proxy: 'traefik' });
		const env = s.apps.find((app) => app.id === 'Auth')?.env ?? {};
		const origins = (env.AUTH_TRUSTED_ORIGINS ?? '').split(',');

		expect(origins).toContain('https://shop.example.com');
		expect(origins).toContain('https://store.shop.example.com');
		expect(origins).not.toContain('https://www.shop.example.com');
	});
});

describe('the Traefik edge', () => {
	it('matches every alias in one parenthesised rule, the token router too', () => {
		const s = deployed({ proxy: 'traefik' });
		const routers = parse(s.traefik!).http.routers;

		expect(routers[`${s.project}-api`].rule).toBe(API_HOSTS);
		expect(routers[`${s.project}-api-stack`].rule).toMatch(
			new RegExp(
				`^${escape(API_HOSTS)} && Header\\(\`${EDGE_TOKEN_HEADER}\`, `,
			),
		);
		expect(routers[`${s.project}-web`].rule).toBe(WEB_HOSTS);
	});

	it('redirects each redirect host permanently to the canonical one, path and query kept', () => {
		const s = deployed({ proxy: 'traefik' });
		const dynamic = parse(s.traefik!).http;
		const router = dynamic.routers[`${s.project}-web-redirect-1`];

		expect(router.rule).toBe('Host(`www.shop.example.com`)');
		expect(router.service).toBe('noop@internal');
		expect(router.tls).toEqual({ certResolver: 'letsencrypt' });
		const middleware = dynamic.middlewares[router.middlewares[0]];
		expect(middleware.redirectRegex).toEqual({
			regex: '^https?://[^/]+(.*)$',
			replacement: 'https://shop.example.com${1}',
			permanent: true,
		});
		// It answers on its own, so a redirect host never reaches the site.
		expect(dynamic.services[`${s.project}-web-redirect-1`]).toBeUndefined();
	});

	it('claims one host per alias and redirect, and reads them back from the rules', () => {
		const s = deployed({ proxy: 'traefik' });
		const hosts = edgeClaims(s.routes).flatMap((claim) =>
			'host' in claim ? [claim.host] : [],
		);
		for (const host of EVERY_HOST) expect(hosts).toContain(host);

		// From the claims line, and from the rules of a file without one.
		const file = s.traefik!;
		expect(readEdgeClaims(file)).toEqual(edgeClaims(s.routes));
		const rulesOnly = file
			.split('\n')
			.filter((line) => !line.startsWith('# gkm-claims: '))
			.join('\n');
		const read = readEdgeClaims(rulesOnly).flatMap((claim) =>
			'host' in claim ? [claim.host] : [],
		);
		for (const host of EVERY_HOST) expect(read).toContain(host);
	});

	it("keeps a wildcard site off every app's alias", () => {
		const s = deployed({ proxy: 'traefik', wildcard: true });
		const web = s.routes.find((route) => route.wildcard);

		expect(web?.wildcard?.except).toContain('rest');
		expect(parse(s.traefik!).http.routers[`${s.project}-web`].rule).toContain(
			'!Host(`rest.shop.example.com`)',
		);
	});
});

describe('the Caddy edge', () => {
	it('serves aliases in the site block, and each redirect from a block of its own', () => {
		const s = deployed({ proxy: 'caddy' });

		expect(s.caddyfile).toContain(
			'https://api.shop.example.com, https://rest.shop.example.com {',
		);
		expect(s.caddyfile).toContain(
			'https://shop.example.com, https://store.shop.example.com {',
		);
		expect(s.caddyfile).toMatch(
			/https:\/\/www\.shop\.example\.com \{\n\tredir https:\/\/shop\.example\.com\{uri\} permanent\n\}/,
		);
	});

	it('keeps an alias out of a wildcard site, as the protected labels', () => {
		const s = deployed({ proxy: 'caddy', wildcard: true });

		expect(s.caddyfile).toMatch(
			/@protected host [^\n]*rest\.shop\.example\.com/,
		);
	});
});

describe('one route, both proxies', () => {
	/** A file server's host with processor handlers, and an alias. */
	const handled: EdgeRoute = {
		name: 'files-assets',
		host: 'assets.example.com',
		aliases: ['cdn.example.com'],
		upstreams: [{ service: 'minio', port: 9000 }],
		streaming: false,
		prefix: '/assets',
		handlers: [
			{
				name: 'processors',
				prefixes: ['/i/'],
				upstreams: [{ service: 'assets-processors', port: 3000 }],
			},
		],
	};
	/** A worker's host, answering only its paths, with an alias. */
	const restricted: EdgeRoute = {
		name: 'jobs',
		host: 'jobs.example.com',
		aliases: ['push.example.com'],
		upstreams: [{ service: 'jobs', port: 3000 }],
		streaming: false,
		paths: ['/__gkm/subscribers/onUser'],
	};
	const routes = [handled, restricted];

	it('holds every handler and condition on every host, for Traefik', () => {
		const routers = traefikDynamic(routes, {
			project: 'shop',
			tls: { kind: 'acme' },
			edgeToken: 'token',
		}).http as { routers: Record<string, { rule: string }> };

		expect(routers.routers['shop-files-assets-processors']!.rule).toBe(
			'(Host(`assets.example.com`) || Host(`cdn.example.com`)) && (PathPrefix(`/i/`))',
		);
		expect(routers.routers['shop-jobs']!.rule).toBe(
			'(Host(`jobs.example.com`) || Host(`push.example.com`)) && (Path(`/__gkm/subscribers/onUser`))',
		);
		expect(routers.routers['shop-jobs-stack']!.rule).toMatch(
			/^\(Host\(`jobs\.example\.com`\) \|\| Host\(`push\.example\.com`\)\) && \(Path/,
		);
	});

	it('holds every handler and condition on every host, for Caddy', () => {
		const caddyfile = edgeCaddyfile(routes, { tls: { kind: 'acme' } });

		expect(caddyfile).toContain(
			'https://assets.example.com, https://cdn.example.com {',
		);
		expect(caddyfile).toContain(
			'https://jobs.example.com, https://push.example.com {',
		);
		// One block per route: the handlers and the path allowlist are inside it.
		expect(caddyfile.match(/handle @handler0/g)).toHaveLength(1);
		expect(caddyfile.match(/@elsewhere not path/g)).toHaveLength(1);
	});

	it('claims the same hosts the stack lists', () => {
		expect(
			edgeClaims(routes).map((claim) => ('host' in claim ? claim.host : '')),
		).toEqual([
			'assets.example.com',
			'cdn.example.com',
			'jobs.example.com',
			'push.example.com',
		]);
		expect(stackHosts({ routes })).toEqual([
			'assets.example.com',
			'cdn.example.com',
			'jobs.example.com',
			'push.example.com',
		]);
		expect(
			readEdgeClaims(
				traefikDynamicFile(routes, { project: 'shop', tls: { kind: 'acme' } }),
			),
		).toEqual(edgeClaims(routes));
	});
});

function escape(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
