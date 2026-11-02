import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
	createServer as createHttpServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import { edgeFetch } from '../health';
import { readSitemap, warmSite } from '../warmup';

/**
 * The warm-up against a real server standing in for the edge: it answers
 * one host, `site.test`, the way the edge routes a site's — so each request
 * is checked for the SNI, `Host` and login it carries, over HTTPS with a CA
 * the request is given, as `verify` trusts Caddy's.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

interface Edge {
	port: number;
	/** Each request, as `<host> <path>`. */
	seen: string[];
	close: () => Promise<void>;
}

let certs: string;
let cert: string;
let key: string;

beforeAll(async () => {
	certs = await createTempDir('gkm-warmup-certs-');
	execFileSync(
		'openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-days',
			'1',
			'-subj',
			'/CN=site.test',
			'-addext',
			'subjectAltName=DNS:site.test',
			'-keyout',
			join(certs, 'key.pem'),
			'-out',
			join(certs, 'cert.pem'),
		],
		{ stdio: 'ignore' },
	);
	cert = readFileSync(join(certs, 'cert.pem'), 'utf-8');
	key = readFileSync(join(certs, 'key.pem'), 'utf-8');
});

afterAll(async () => {
	await cleanupDir(certs);
});

async function serve(secure: boolean, handler: Handler): Promise<Edge> {
	const seen: string[] = [];
	const record: Handler = (req, res) => {
		seen.push(`${req.headers.host} ${req.url}`);
		handler(req, res);
	};
	const server = secure
		? createHttpsServer({ cert, key }, record)
		: createHttpServer(record);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return {
		port: (server.address() as AddressInfo).port,
		seen,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

function xml(res: ServerResponse, body: string): void {
	res.writeHead(200, { 'content-type': 'application/xml' });
	res.end(body);
}

const urlset = (locs: string[]) =>
	`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${locs.map((loc) => `  <url><loc>${loc}</loc><image:image><image:loc>https://site.test/cover.png</image:loc></image:image></url>`).join('\n')}
</urlset>`;

describe('warming a site through the edge', () => {
	it('asks its root and every page its sitemap index lists, and warns on each that fails', async () => {
		const edge = await serve(true, (req, res) => {
			switch (req.url) {
				case '/sitemap.xml':
					return xml(
						res,
						`<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://site.test/sitemaps/pages.xml</loc></sitemap>
  <sitemap><loc>https://site.test/sitemaps/posts.xml</loc></sitemap>
  <sitemap><loc>https://site.test/sitemaps/down.xml</loc></sitemap>
  <sitemap><loc>https://elsewhere.test/sitemap.xml</loc></sitemap>
</sitemapindex>`,
					);
				case '/sitemaps/pages.xml':
					return xml(
						res,
						urlset([
							'https://site.test/',
							'https://site.test/about',
							'https://site.test/search?q=a&amp;page=2',
							'https://elsewhere.test/about',
						]),
					);
				case '/sitemaps/posts.xml':
					return xml(
						res,
						urlset([
							'https://site.test/posts/1',
							'https://site.test/posts/broken',
							'https://site.test/posts/slow',
						]),
					);
				case '/sitemaps/down.xml':
				case '/posts/broken':
					res.writeHead(500);
					return res.end();
				case '/posts/slow':
					// Never answers: the request times out.
					return;
				default:
					res.writeHead(200, { 'content-type': 'text/html' });
					return res.end('<html></html>');
			}
		});

		try {
			const result = await warmSite({
				url: 'https://site.test',
				fetch: edgeFetch,
				edge: { connectTo: '127.0.0.1', connectPort: edge.port, ca: cert },
				timeoutMs: 500,
			});

			expect(result.warmed.sort()).toEqual([
				'https://site.test/',
				'https://site.test/about',
				'https://site.test/posts/1',
				'https://site.test/search?q=a&page=2',
			]);
			expect(result.warnings).toEqual(
				expect.arrayContaining([
					{ url: 'https://site.test/sitemaps/down.xml', reason: 'HTTP 500' },
					{ url: 'https://site.test/posts/broken', reason: 'HTTP 500' },
					{
						url: 'https://site.test/posts/slow',
						reason: 'no answer within 500ms',
					},
				]),
			);
			expect(result.warnings).toHaveLength(3);
			expect(result.leftOut).toBe(0);

			// Every request by the site's own host, each page once — the root
			// too, though a sitemap lists it — and nothing of another site's
			// nor an image's.
			expect(edge.seen.every((line) => line.startsWith('site.test '))).toBe(
				true,
			);
			const paths = edge.seen.map((line) => line.split(' ')[1]);
			expect(paths.filter((p) => p === '/')).toHaveLength(1);
			expect(paths).not.toContain('/cover.png');
			expect(paths[0]).toBe('/');
			expect(paths[1]).toBe('/sitemap.xml');
		} finally {
			await edge.close();
		}
	});

	it('warms only the root of a site with no sitemap, and sends its login', async () => {
		const authorizations: (string | undefined)[] = [];
		const edge = await serve(false, (req, res) => {
			authorizations.push(req.headers.authorization);
			res.writeHead(req.url === '/' ? 200 : 404);
			res.end();
		});

		try {
			const result = await warmSite({
				url: `http://site.test:${edge.port}`,
				fetch: edgeFetch,
				edge: { connectTo: '127.0.0.1', authorization: 'Basic dTpw' },
			});

			expect(result).toEqual({
				warmed: [`http://site.test:${edge.port}/`],
				warnings: [],
				leftOut: 0,
			});
			expect(edge.seen).toEqual([
				`site.test:${edge.port} /`,
				`site.test:${edge.port} /sitemap.xml`,
			]);
			expect(authorizations).toEqual(['Basic dTpw', 'Basic dTpw']);
		} finally {
			await edge.close();
		}
	});

	it('asks at most its limit of pages, a few at a time', async () => {
		let inFlight = 0;
		let most = 0;
		const edge = await serve(false, (req, res) => {
			if (req.url === '/sitemap.xml') {
				return xml(
					res,
					urlset(
						Array.from(
							{ length: 20 },
							(_, i) => `http://site.test:${edge.port}/p/${i}`,
						),
					),
				);
			}
			inFlight++;
			most = Math.max(most, inFlight);
			setTimeout(() => {
				inFlight--;
				res.writeHead(200);
				res.end();
			}, 20);
		});

		try {
			const result = await warmSite({
				url: `http://site.test:${edge.port}`,
				fetch: edgeFetch,
				edge: { connectTo: '127.0.0.1' },
				maxUrls: 8,
				concurrency: 3,
			});

			// The root, and seven of the sitemap's twenty.
			expect(result.warmed).toHaveLength(8);
			expect(result.leftOut).toBe(13);
			expect(most).toBeLessThanOrEqual(3);
			expect(most).toBeGreaterThan(1);
		} finally {
			await edge.close();
		}
	});
});

describe('reading a sitemap', () => {
	it('reads each entry, entity-decoded or from CDATA, and no image', () => {
		expect(
			readSitemap(
				urlset([
					'https://site.test/a?x=1&amp;y=2',
					'<![CDATA[https://site.test/b?x=1&y=2]]>',
				]),
			),
		).toEqual({
			kind: 'urlset',
			locs: ['https://site.test/a?x=1&y=2', 'https://site.test/b?x=1&y=2'],
		});
	});

	it('tells an index from a list of pages', () => {
		expect(
			readSitemap(
				'<sitemapindex><sitemap><loc>https://site.test/s.xml</loc></sitemap></sitemapindex>',
			),
		).toEqual({ kind: 'index', locs: ['https://site.test/s.xml'] });
	});
});
