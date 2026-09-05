import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { caddyfileRoot, hostFor, sitesFor, toCaddyfile } from '../caddyfile';
import { planFor } from '../plan';

const manifest = {
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
	UploadsServer: {
		kind: 'file-server',
		id: 'UploadsServer',
		of: 'Uploads',
		open: ['brand/**'],
		provides: ['UPLOADS_SERVER_URL'],
	},
	// A second surface over the same bucket: two cache behaviours, one origin.
	AssetsServer: {
		kind: 'file-server',
		id: 'AssetsServer',
		of: 'Uploads',
		open: ['avatars/*.png'],
		provides: ['ASSETS_SERVER_URL'],
	},
} as const satisfies ConstructManifest;

const plan = (stage = 'development') =>
	planFor(manifest, stage, provisionOrder(manifest));

describe('sitesFor', () => {
	it('gives each file server a host of its own', () => {
		// The leading label is the *server's* name, not the bucket's — which is
		// what lets two servers front one bucket. Naming the host after the
		// bucket would make them collide, and that arrangement is legitimate.
		const hosts = sitesFor(plan(), 'shop').map((s) => s.host);

		expect(hosts).toEqual([
			'uploadsserver.shop.localhost',
			'assetsserver.shop.localhost',
		]);
	});

	it('points both at the one bucket behind them', () => {
		// The bucket is a rewrite on a shared origin rather than part of either
		// address — which is what lets two servers front one bucket at all.
		expect(sitesFor(plan(), 'shop').map((s) => s.rewrite)).toEqual([
			'/uploads{uri}',
			'/uploads{uri}',
		]);
		expect(sitesFor(plan(), 'shop').map((s) => s.upstream)).toEqual([
			'http://minio:9000',
			'http://minio:9000',
		]);
	});

	it('routes a surface and a site to the process serving them', () => {
		// Not a container: `gkm dev` starts these on the host, so the edge has to
		// leave Docker's network to reach them. Their addresses arrive as options
		// because whatever started them assigned the ports.
		const withSurface = {
			Api: { kind: 'rest-api', id: 'Api', endpoints: [] },
			Web: {
				kind: 'site',
				id: 'Web',
				variant: 'static',
				path: 'apps/web',
				dependencies: [{ target: 'Api', kind: 'rest-api' }],
			},
		} as const satisfies ConstructManifest;

		const sites = sitesFor(
			planFor(withSurface, 'development', provisionOrder(withSurface)),
			'shop',
			{ Api: 'http://localhost:3000', Web: 'http://localhost:5173' },
		);

		expect(sites).toEqual([
			{
				host: 'api.shop.localhost',
				upstream: 'http://host.docker.internal:3000',
			},
			{
				host: 'web.shop.localhost',
				upstream: 'http://host.docker.internal:5173',
			},
		]);
	});

	it('routes nothing to a surface nothing has started', () => {
		// The ordinary state before `gkm dev` has decided where things listen.
		const withSurface = {
			Api: { kind: 'rest-api', id: 'Api', endpoints: [] },
		} as const satisfies ConstructManifest;

		expect(
			sitesFor(
				planFor(withSurface, 'development', provisionOrder(withSurface)),
				'shop',
			),
		).toEqual([]);
	});

	it('separates stages by host rather than by path', () => {
		// The stage is already in the resource name, so it lands in the label and
		// two stages cannot answer on one address.
		expect(sitesFor(plan('test'), 'shop')[0]).toEqual({
			host: 'uploadsserver-test.shop.localhost',
			upstream: 'http://minio:9000',
			rewrite: '/uploads-test{uri}',
		});
	});

	it('routes nothing for a project with no file server', () => {
		const bucketOnly = {
			Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
		} as const satisfies ConstructManifest;

		expect(
			sitesFor(
				planFor(bucketOnly, 'development', provisionOrder(bucketOnly)),
				'shop',
			),
		).toEqual([]);
	});
});

describe('hostFor', () => {
	it('omits the project when there is none to name', () => {
		// An empty label makes `uploads..localhost`, which nothing resolves and no
		// certificate can be issued for.
		const [server] = plan().resources.filter((r) => r.kind === 'file-server');

		expect(hostFor(server as never, '')).toBe('uploadsserver.localhost');
	});
});

describe('caddyfileRoot', () => {
	it('issues its own certificates rather than asking an authority', () => {
		// `local_certs` rather than ACME: the CA is local and so are the names, so
		// there is nothing to prove to a public one.
		expect(caddyfileRoot()).toContain('local_certs');
	});

	it('imports each stage rather than holding the routes itself', () => {
		// One edge serves every stage, the same way one Postgres holds `orders`
		// and `orders_test`. A single file of routes would mean `gkm test`
		// deleting what `gkm dev` is serving.
		expect(caddyfileRoot()).toContain('import /etc/caddy/sites/*.caddy');
		expect(caddyfileRoot()).not.toContain('reverse_proxy');
	});
});

describe('toCaddyfile', () => {
	const rendered = () => toCaddyfile(sitesFor(plan(), 'shop'));

	it('serves each host over TLS from the local CA', () => {
		expect(rendered()).toContain('https://uploadsserver.shop.localhost {');
		expect(rendered()).toContain('tls internal');
	});

	it('rewrites the bucket in as a prefix', () => {
		// The client asks for the key it stored; the bucket is the origin's
		// business and never part of the address.
		expect(rendered()).toContain('rewrite /uploads{uri}');
	});

	it('sends the origin its own host, not the browser’s', () => {
		// MinIO routes and signs on the Host header, so forwarding the requested
		// hostname would make it look for a bucket named after the domain.
		expect(rendered()).toContain('header_up Host {upstream_hostport}');
	});

	it('renders a routeless edge rather than an invalid one', () => {
		// An empty site list is a project that declared no file server, which is
		// ordinary — not a reason to emit a config Caddy refuses to load.
		expect(toCaddyfile([])).toContain('routes nothing');
	});
});
