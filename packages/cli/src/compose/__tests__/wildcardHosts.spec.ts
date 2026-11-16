import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { loadWorkspaceConfig } from '../../config';
import { deployIdentity } from '../../deploy/identity';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { initStageSecrets } from '../../secrets/storage';
import { SiteHostsEndpointMissing } from '../../workspace/subdomains';
import type { NormalizedWorkspace } from '../../workspace/types';
import { composeStack, WildcardSiteCertificateMissing } from '../stack';
import {
	type ComposeAppOptions,
	loadComposeApp,
	WARM_TIMEOUT,
	writeComposeApp,
} from './__helpers__/composeApp';

/**
 * A wildcard site's `hosts`, as a project writes it in its constructs: named
 * by surface and path, given as the endpoint itself, or not at all — each
 * discovered from source, as `gkm compose` reads it.
 */

type Form = NonNullable<ComposeAppOptions['wildcard']>;

const projects = new Map<
	Form,
	{
		dir: string;
		workspace: NormalizedWorkspace;
		manifest: ConstructManifest;
		background: Record<string, string[]>;
	}
>();

beforeAll(async () => {
	for (const form of [true, 'endpoint', 'no-hosts'] as const) {
		const dir = realpathSync(await createTempDir('gkm-wildcard-hosts-'));
		writeComposeApp(dir, {
			registry: 'registry.example.com/acme',
			wildcard: form,
		});
		projects.set(form, { dir, ...(await loadComposeApp(dir)) });
	}
}, WARM_TIMEOUT * 3);

afterAll(async () => {
	for (const { dir } of projects.values()) await cleanupDir(dir);
});

function deployed(
	form: Form,
	options: { proxy: 'caddy' | 'traefik'; route53?: boolean; tls?: boolean },
) {
	const project = projects.get(form)!;
	const ws: NormalizedWorkspace = {
		...project.workspace,
		...(options.route53
			? { dns: { 'example.com': { provider: 'route53' } as never } }
			: {}),
		deploy: {
			...project.workspace.deploy,
			compose: {
				...project.workspace.deploy?.compose,
				proxy: options.proxy,
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
		manifest: project.manifest,
		background: project.background,
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

describe('hosts named by surface and path', () => {
	it('declares the same check the endpoint did', () => {
		expect(projects.get(true)!.manifest.Web).toEqual(
			projects.get('endpoint')!.manifest.Web,
		);
		expect(projects.get(true)!.manifest.Web).toMatchObject({
			hosts: { surface: 'Api', path: '/tenants/hosts' },
		});
	});

	it("renders Caddy's on-demand ask exactly as the endpoint did", () => {
		const byReference = deployed(true, { proxy: 'caddy' });
		const byEndpoint = deployed('endpoint', { proxy: 'caddy' });
		const api = byReference.apps.find((a) => a.name === 'api')!;

		expect(byReference.caddyfile).toContain(
			`on_demand_tls {\n\t\task http://api:${api.port}/tenants/hosts\n\t}`,
		);
		expect(byReference.caddyfile).toBe(byEndpoint.caddyfile);
	});

	it('is refused where the project reads its graph, when the surface does not serve the route', async () => {
		const dir = realpathSync(await createTempDir('gkm-wildcard-hosts-'));
		try {
			writeComposeApp(dir, { wildcard: true });
			const site = join(dir, 'constructs', 'site.ts');
			writeFileSync(
				site,
				readFileSync(site, 'utf-8').replace(
					"path: '/tenants/hosts'",
					"path: '/tenants/nope'",
				),
			);

			const error = await loadWorkspaceConfig(dir).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(SiteHostsEndpointMissing);
			expect((error as Error).message).toContain('GET /tenants/nope');
		} finally {
			await cleanupDir(dir);
		}
	});
});

describe('a wildcard site without hosts', () => {
	it('declares no check', () => {
		expect(projects.get('no-hosts')!.manifest.Web).not.toHaveProperty('hosts');
	});

	it('renders on a stage whose edge gets its certificate over the DNS challenge', () => {
		const s = deployed('no-hosts', { proxy: 'traefik', route53: true });
		const routers = parse(s.traefik!).http.routers;

		expect(routers[`${s.project}-web`].tls).toEqual({
			certResolver: 'letsencrypt-dns',
			domains: [{ main: '*.shop.example.com' }],
		});
		expect(s.wildcard?.tls).toBe('dns');
	});

	it('renders on a stage with its own certificate, on either proxy', () => {
		expect(
			deployed('no-hosts', { proxy: 'traefik', tls: true }).wildcard?.tls,
		).toBe('stage');
		const caddy = deployed('no-hosts', { proxy: 'caddy', tls: true });
		expect(caddy.wildcard?.tls).toBe('stage');
		expect(caddy.caddyfile).not.toContain('on_demand');
	});

	it('is refused where Caddy would get certificates on demand, saying why', () => {
		expect(() => deployed('no-hosts', { proxy: 'caddy' })).toThrow(
			WildcardSiteCertificateMissing,
		);
		expect(() => deployed('no-hosts', { proxy: 'caddy' })).toThrow(
			/On-demand certificates need it/,
		);
	});
});
