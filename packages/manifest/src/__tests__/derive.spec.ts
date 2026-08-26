import { describe, expect, it } from 'vitest';
import type { ConstructManifest } from '../declaration';
import {
	assertDerivations,
	dependentsOf,
	isDerived,
	provisionOrder,
} from '../derive';
import { IllegalDerivation, UnknownParent } from '../errors';

/** A database, a reader on it, and a schema tenant — the shape the doc uses. */
const manifest = {
	Orders: { kind: 'database', id: 'Orders', provides: ['ORDERS_URL'] },
	OrdersReader: {
		kind: 'database-reader',
		id: 'OrdersReader',
		of: 'Orders',
		provides: ['ORDERS_READER_URL'],
	},
	Auth: {
		kind: 'database-schema',
		id: 'Auth',
		of: 'Orders',
		schema: 'auth',
		provides: ['AUTH_URL'],
	},
} as const satisfies ConstructManifest;

describe('isDerived', () => {
	it('is true for constructs that name a parent', () => {
		expect(isDerived(manifest.OrdersReader)).toBe(true);
		expect(isDerived(manifest.Auth)).toBe(true);
	});

	it('is false for constructs that provision themselves', () => {
		expect(isDerived(manifest.Orders)).toBe(false);
	});
});

describe('assertDerivations', () => {
	it('accepts a reader and a schema on a database', () => {
		expect(() => assertDerivations(manifest)).not.toThrow();
	});

	it('accepts a reader on a schema tenant', () => {
		expect(() =>
			assertDerivations({
				...manifest,
				AuthReader: {
					kind: 'database-reader',
					id: 'AuthReader',
					of: 'Auth',
				},
			}),
		).not.toThrow();
	});

	it('rejects a parent the manifest does not contain', () => {
		try {
			assertDerivations({
				Ghost: { kind: 'database-reader', id: 'Ghost', of: 'Missing' },
			});
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(UnknownParent);
			const e = error as UnknownParent;
			expect(e.id).toBe('Ghost');
			expect(e.of).toBe('Missing');
			expect(e.available).toEqual(['Ghost']);
		}
	});

	it('rejects a schema tenant of a schema tenant', () => {
		try {
			assertDerivations({
				...manifest,
				Nested: {
					kind: 'database-schema',
					id: 'Nested',
					of: 'Auth',
					schema: 'nested',
				},
			});
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(IllegalDerivation);
			const e = error as IllegalDerivation;
			expect(e.parentKind).toBe('database-schema');
			expect(e.allowed).toEqual(['database']);
		}
	});

	it('rejects a reader of a reader, which is what makes readers terminal', () => {
		expect(() =>
			assertDerivations({
				...manifest,
				Chained: {
					kind: 'database-reader',
					id: 'Chained',
					of: 'OrdersReader',
				},
			}),
		).toThrow(IllegalDerivation);
	});

	it('rejects deriving from an unrelated kind', () => {
		expect(() =>
			assertDerivations({
				Uploads: { kind: 'objects', id: 'Uploads' },
				Reader: { kind: 'database-reader', id: 'Reader', of: 'Uploads' },
			}),
		).toThrow(IllegalDerivation);
	});
});

describe('provisionOrder', () => {
	it('places a parent before the constructs derived from it', () => {
		// Declared child-first, so insertion order alone would be wrong.
		const order = provisionOrder({
			OrdersReader: {
				kind: 'database-reader',
				id: 'OrdersReader',
				of: 'Orders',
			},
			Orders: { kind: 'database', id: 'Orders' },
		});

		expect(order).toEqual(['Orders', 'OrdersReader']);
	});

	it('places a grandparent before a reader on a schema tenant', () => {
		const order = provisionOrder({
			AuthReader: { kind: 'database-reader', id: 'AuthReader', of: 'Auth' },
			Auth: {
				kind: 'database-schema',
				id: 'Auth',
				of: 'Orders',
				schema: 'auth',
			},
			Orders: { kind: 'database', id: 'Orders' },
		});

		expect(order).toEqual(['Orders', 'Auth', 'AuthReader']);
	});

	it('includes every construct exactly once', () => {
		const order = provisionOrder(manifest);
		expect(order).toHaveLength(Object.keys(manifest).length);
		expect(new Set(order).size).toBe(order.length);
	});

	it('leaves resources in declaration order', () => {
		expect(
			provisionOrder({
				Uploads: { kind: 'objects', id: 'Uploads' },
				Assets: { kind: 'objects', id: 'Assets' },
			}),
		).toEqual(['Uploads', 'Assets']);
	});

	it('terminates on a cycle rather than recursing forever', () => {
		// `assertDerivations` rules this out; ordering must not hang if it is
		// skipped, because a stack overflow at synth is a worse failure than a
		// wrong order.
		expect(() =>
			provisionOrder({
				A: { kind: 'database-reader', id: 'A', of: 'B' },
				B: { kind: 'database-reader', id: 'B', of: 'A' },
			}),
		).not.toThrow();
	});
});

describe('dependentsOf', () => {
	const manifest = {
		Auth: {
			kind: 'rest-api',
			id: 'Auth',
			endpoints: [
				{
					id: 'AuthHandler',
					handler: 'Auth.handler',
					method: 'ANY',
					path: '/api/auth/*',
					dependencies: [{ target: 'AuthDb', kind: 'database-schema' }],
				},
			],
		},
		Api: {
			kind: 'rest-api',
			id: 'Api',
			endpoints: [],
			dependencies: [{ target: 'Auth', kind: 'rest-api' }],
		},
		Console: {
			kind: 'site',
			id: 'Console',
			variant: 'static',
			path: 'apps/console',
			dependencies: [
				{ target: 'Api', kind: 'rest-api' },
				{ target: 'Auth', kind: 'rest-api' },
			],
		},
		Orders: { kind: 'database', id: 'Orders' },
		AuthDb: {
			kind: 'database-schema',
			id: 'AuthDb',
			of: 'Orders',
			schema: 'auth',
		},
	} as const satisfies ConstructManifest;

	it('reads the graph backwards', () => {
		expect(dependentsOf(manifest, 'Auth')).toEqual(['Api', 'Console']);
		expect(dependentsOf(manifest, 'Api')).toEqual(['Console']);
	});

	it('finds an edge whether it sits on the node or on a handler', () => {
		// A site depends as a whole; a surface's routes depend one at a time.
		// Nothing reading the graph should have to know which.
		expect(dependentsOf(manifest, 'AuthDb')).toEqual(['Auth']);
	});

	it('is empty for something nothing calls', () => {
		// A real state, and the one every surface starts in.
		expect(dependentsOf(manifest, 'Console')).toEqual([]);
	});

	it('does not count a construct as its own caller', () => {
		const selfish = {
			Api: {
				kind: 'rest-api',
				id: 'Api',
				endpoints: [],
				dependencies: [{ target: 'Api', kind: 'rest-api' }],
			},
		} as const satisfies ConstructManifest;

		expect(dependentsOf(selfish, 'Api')).toEqual([]);
	});
});
