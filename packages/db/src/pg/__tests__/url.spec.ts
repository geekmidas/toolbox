import { describe, expect, it } from 'vitest';
import { MissingDatabaseHost, MissingDatabaseName } from '../../errors';
import { build } from '../url';

describe('pg/url build', () => {
	it('composes the minimum a connection needs', () => {
		expect(build({ host: 'db.internal', database: 'orders' })).toBe(
			'postgres://db.internal/orders',
		);
	});

	it('carries the role and its password', () => {
		expect(
			build({
				host: 'db.internal',
				database: 'orders',
				username: 'app',
				password: 'hunter2',
			}),
		).toBe('postgres://app:hunter2@db.internal/orders');
	});

	it('omits the default port, so URLs for the same database compare equal', () => {
		expect(build({ host: 'db.internal', port: 5432, database: 'orders' })).toBe(
			'postgres://db.internal/orders',
		);
	});

	it('keeps a non-default port', () => {
		expect(build({ host: 'localhost', port: 55432, database: 'orders' })).toBe(
			'postgres://localhost:55432/orders',
		);
	});

	it('encodes search_path as a libpq option, not a query parameter', () => {
		// `?search_path=app` parses fine and is ignored by the server, which is
		// the failure this function exists to prevent.
		expect(
			build({ host: 'db.internal', database: 'orders', searchPath: 'app' }),
		).toBe('postgres://db.internal/orders?options=-c+search_path%3Dapp');
	});

	it('disables ssl only when explicitly asked', () => {
		expect(build({ host: 'localhost', database: 'orders', ssl: false })).toBe(
			'postgres://localhost/orders?sslmode=disable',
		);
		expect(build({ host: 'localhost', database: 'orders' })).not.toContain(
			'sslmode',
		);
	});

	it('escapes credentials containing URL-significant characters', () => {
		// A generated password contains whatever the generator produced; an
		// unescaped `@` or `/` silently redirects the connection elsewhere.
		expect(
			build({
				host: 'db.internal',
				database: 'orders',
				username: 'app',
				password: 'p@ss/word',
			}),
		).toBe('postgres://app:p%40ss%2Fword@db.internal/orders');
	});

	it('rejects an address with no host', () => {
		expect(() => build({ host: '', database: 'orders' })).toThrow(
			MissingDatabaseHost,
		);
	});

	it('rejects an address with no database', () => {
		// Postgres would fall back to the role name and connect to the wrong one.
		expect(() => build({ host: 'db.internal', database: '' })).toThrow(
			MissingDatabaseName,
		);
	});

	it('does not put the password in the error when composition fails', () => {
		try {
			build({ host: '', database: 'orders', password: 'hunter2' });
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(JSON.stringify(error)).not.toContain('hunter2');
			expect((error as Error).message).not.toContain('hunter2');
		}
	});
});
