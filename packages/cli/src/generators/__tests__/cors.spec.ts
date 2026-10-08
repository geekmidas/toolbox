import type { AddressInfo } from 'node:net';
import { EnvironmentParser } from '@geekmidas/envkit';
import { type ServerType, serve } from '@hono/node-server';
import { transform } from 'esbuild';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { afterEach, describe, expect, it } from 'vitest';
import type { BuildContext } from '../../build/types';
import { corsFor } from '../EndpointGenerator';

/**
 * CORS is derived, so no application writes an origin list.
 *
 * Who may call a surface is already in the graph — every construct that
 * declared an edge to it — and reaches the process as `<ID>_TRUSTED_ORIGINS`.
 * A hand-maintained list was wrong in two directions at once: it trusted
 * origins nothing was serving, and it could not name hosts a deploy had not
 * chosen yet.
 */
const surface = (
	cors?: BuildContext['surface'] extends infer S
		? S extends { cors?: infer C }
			? C
			: never
		: never,
): BuildContext['surface'] => ({
	id: 'Api',
	trustedOriginsKey: 'API_TRUSTED_ORIGINS',
	...(cors ? { cors } : {}),
});

describe('corsFor', () => {
	it('reads the origins from the key the surface publishes', () => {
		const { setup, imports } = corsFor(surface());

		expect(imports).toContain("from 'hono/cors'");
		expect(setup).toContain("get('API_TRUSTED_ORIGINS')");
		// The list itself is never in the output — only the key it arrives under.
		expect(setup).not.toMatch(/https?:\/\//);
	});

	it('needs nothing declared to produce working CORS', () => {
		// A surface that says nothing about CORS still gets it, with defaults.
		const { setup } = corsFor(surface());

		expect(setup).toContain('credentials: true');
		expect(setup).toContain('maxAge: 86400');
		expect(setup).toContain('"content-type"');
		expect(setup).toContain('"authorization"');
		// What a site's client sends when its telemetry is on.
		expect(setup).toContain('"traceparent"');
		expect(setup).toContain('"tracestate"');
	});

	it('takes the knobs a graph cannot answer', () => {
		const { setup } = corsFor(
			surface({
				maxAge: 3600,
				credentials: false,
				allowHeaders: ['x-tenant'],
				exposeHeaders: ['x-request-id'],
			}),
		);

		expect(setup).toContain('maxAge: 3600');
		expect(setup).toContain('credentials: false');
		expect(setup).toContain('"x-tenant"');
		expect(setup).toContain('exposeHeaders: ["x-request-id"]');
	});

	it('emits nothing for an app that declares no surface', () => {
		// Adopting constructs stays something done a piece at a time.
		expect(corsFor(undefined)).toEqual({ imports: '', setup: '' });
	});

	describe('a real preflight', () => {
		let server: ServerType | undefined;

		afterEach(async () => {
			await new Promise<void>((resolve) =>
				server ? server.close(() => resolve()) : resolve(),
			);
			server = undefined;
		});

		/**
		 * The generated CORS block, run as the entry runs it — against a Hono
		 * app and the surface's environment parser — and served on a socket.
		 */
		async function serveGeneratedCors(origins: string): Promise<string> {
			const { setup } = corsFor(surface());
			const { code } = await transform(setup, { loader: 'ts' });
			const honoApp = new Hono();
			const trustedOrigins: string[] = [];
			const envParser = new EnvironmentParser({
				API_TRUSTED_ORIGINS: origins,
			});
			new Function('honoApp', 'envParser', 'cors', 'trustedOrigins', code)(
				honoApp,
				envParser,
				cors,
				trustedOrigins,
			);
			honoApp.post('/users', (c) => c.json({ ok: true }));

			server = await new Promise<ServerType>((resolve) => {
				const s = serve(
					{ fetch: honoApp.fetch, port: 0, hostname: '127.0.0.1' },
					() => resolve(s),
				);
			});
			return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		}

		it("lets the API's own site send traceparent and tracestate", async () => {
			const url = await serveGeneratedCors('https://web.example.com');

			const response = await fetch(`${url}/users`, {
				method: 'OPTIONS',
				headers: {
					origin: 'https://web.example.com',
					'access-control-request-method': 'POST',
					'access-control-request-headers':
						'content-type, traceparent, tracestate',
				},
			});

			expect(response.status).toBe(204);
			expect(response.headers.get('access-control-allow-origin')).toBe(
				'https://web.example.com',
			);
			const allowed = response.headers
				.get('access-control-allow-headers')
				?.split(',')
				.map((h) => h.trim());
			expect(allowed).toEqual(
				expect.arrayContaining(['content-type', 'traceparent', 'tracestate']),
			);
		});

		it('allows nothing for an origin that is not its own', async () => {
			const url = await serveGeneratedCors('https://web.example.com');

			const response = await fetch(`${url}/users`, {
				method: 'OPTIONS',
				headers: {
					origin: 'https://evil.example.net',
					'access-control-request-method': 'POST',
					'access-control-request-headers': 'traceparent',
				},
			});

			expect(response.headers.get('access-control-allow-origin')).toBeNull();
		});

		it('hands the same origins to the request spans', async () => {
			const { setup } = corsFor(surface());
			const { code } = await transform(setup, { loader: 'ts' });
			const trustedOrigins: string[] = [];

			new Function('honoApp', 'envParser', 'cors', 'trustedOrigins', code)(
				new Hono(),
				new EnvironmentParser({
					API_TRUSTED_ORIGINS:
						'https://web.example.com, https://admin.example.com',
				}),
				cors,
				trustedOrigins,
			);

			expect(trustedOrigins).toEqual([
				'https://web.example.com',
				'https://admin.example.com',
			]);
		});
	});
});
