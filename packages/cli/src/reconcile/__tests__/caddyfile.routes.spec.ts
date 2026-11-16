import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { toCaddyfile } from '../caddyfile';
import { planFor } from '../plan';
import { localRoutes, MINIO_UPSTREAM } from '../routes';

/**
 * The edge routes only what it can reach: a file server with a bucket behind
 * it, and a surface or site at an address somebody assigned.
 */
const plan = (manifest: ConstructManifest) =>
	planFor(manifest, 'dev', provisionOrder(manifest), { localStage: 'dev' });

const api = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: '.',
		endpoints: [],
		provides: ['API_URL'],
	},
} as const satisfies ConstructManifest;

describe('localRoutes', () => {
	it('defaults the port by scheme when the address names none', () => {
		const sites = (address: string) =>
			localRoutes(plan(api), 'shop', { addresses: { Api: address } });

		expect(sites('http://localhost')[0]?.upstreams).toEqual([
			{ onHost: true, port: 80 },
		]);
		expect(sites('https://localhost')[0]?.upstreams).toEqual([
			{ onHost: true, port: 443 },
		]);
	});

	it('routes nothing to an address it cannot read', () => {
		expect(
			localRoutes(plan(api), 'shop', { addresses: { Api: 'not a url' } }),
		).toEqual([]);
	});

	it('skips a file server whose bucket is not in the plan', () => {
		const orphan = {
			Downloads: {
				kind: 'file-server',
				id: 'Downloads',
				of: 'Missing',
				open: [],
				provides: ['DOWNLOADS_URL'],
			},
		} as const satisfies ConstructManifest;

		expect(localRoutes(plan(orphan), 'shop')).toEqual([]);
	});
});

describe('toCaddyfile', () => {
	it('forwards the host a caller used to an app, but not to a bucket', () => {
		const file = toCaddyfile(
			[
				{
					name: 'api',
					host: 'api.shop.localhost',
					upstreams: [{ onHost: true, port: 3000 }],
					streaming: true,
				},
				{
					name: 'files',
					host: 'files.shop.localhost',
					upstreams: [MINIO_UPSTREAM],
					streaming: false,
					prefix: '/uploads',
				},
			],
			{ certificate: '/etc/caddy/sites/dev.pem' },
		);

		const [app, bucket] = file.split('https://').slice(1);
		expect(app).toContain('header_up Host {host}');
		expect(app).toContain('header_up X-Forwarded-Proto {scheme}');
		expect(app).not.toContain('rewrite');
		expect(bucket).toContain('rewrite /uploads{uri}');
		expect(bucket).toContain('header_up Host {upstream_hostport}');
	});
});
