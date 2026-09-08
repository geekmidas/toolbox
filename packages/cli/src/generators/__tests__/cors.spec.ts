import { describe, expect, it } from 'vitest';
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
});
