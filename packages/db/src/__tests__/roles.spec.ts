import { describe, expect, it } from 'vitest';
import {
	ownerRole,
	ReaderNeedsPassword,
	readerRole,
	roleStatements,
} from '../pg/roles';

const spec = {
	runtime: 'orders',
	owner: 'orders_owner',
	schema: 'app',
	passwords: { runtime: 'r-pw', owner: 'o-pw' },
};

const sqlOf = (s: typeof spec) => roleStatements(s).map((x) => x.sql);

describe('roleStatements', () => {
	it('creates the owner before the schema it owns', () => {
		// Creating the schema as the cluster master and granting afterwards
		// leaves a window where the master owns objects the owner should.
		const sql = sqlOf(spec);
		const owner = sql.findIndex((s) =>
			s.includes('CREATE ROLE "orders_owner"'),
		);
		const schema = sql.findIndex((s) => s.includes('CREATE SCHEMA'));

		expect(owner).toBeLessThan(schema);
		expect(sql[schema]).toContain('AUTHORIZATION "orders_owner"');
	});

	it('gives the runtime role no ability to create anything', () => {
		// The property the whole split exists for: a compromised handler cannot
		// DROP TABLE, because its role holds no such grant.
		const granted = sqlOf(spec).filter(
			(s) => s.startsWith('GRANT') && s.includes('TO "orders"'),
		);

		expect(granted.length).toBeGreaterThan(0);
		for (const statement of granted) {
			expect(statement).not.toMatch(
				/CREATE|ALL PRIVILEGES|TRUNCATE|REFERENCES/,
			);
		}
	});

	it('covers tables the next migration has not created yet', () => {
		// A grant on what exists today covers nothing the next migration makes,
		// which is how a runtime role silently loses access one deploy later.
		expect(sqlOf(spec)).toContainEqual(
			expect.stringContaining(
				'ALTER DEFAULT PRIVILEGES FOR ROLE "orders_owner"',
			),
		);
	});

	it('pins search_path on the role rather than in a URL', () => {
		expect(sqlOf(spec)).toContainEqual(
			'ALTER ROLE "orders" SET search_path TO "app"',
		);
	});

	it('checks before creating a role, and not before granting', () => {
		// A GRANT re-granting what is already granted is a no-op; checking would
		// cost a round trip to learn nothing.
		const statements = roleStatements(spec);

		expect(
			statements
				.filter((s) => s.sql.startsWith('CREATE'))
				.every((s) => s.exists),
		).toBe(true);
		expect(
			statements
				.filter((s) => s.sql.startsWith('GRANT'))
				.every((s) => !s.exists),
		).toBe(true);
	});

	it('escapes a password rather than trusting the caller', () => {
		const [ownerStatement] = roleStatements({
			...spec,
			passwords: { runtime: 'r', owner: "it's" },
		});

		expect(ownerStatement?.sql).toContain("'it''s'");
	});

	it('creates no reader role unless one was asked for', () => {
		// Roles nothing connects as are noise in `\du` and one more thing to
		// explain.
		expect(sqlOf(spec).some((s) => s.includes('_reader'))).toBe(false);
	});
});

describe('the reader role', () => {
	const withReader = {
		...spec,
		reader: 'orders_reader',
		passwords: { ...spec.passwords, reader: 'rd-pw' },
	};

	it('may read and do nothing else', () => {
		const granted = sqlOf(withReader).filter(
			(s) => s.startsWith('GRANT') && s.includes('TO "orders_reader"'),
		);

		for (const statement of granted) {
			expect(statement).not.toMatch(/INSERT|UPDATE|DELETE|SEQUENCE/);
		}
	});

	it('refuses to be created without a password of its own', () => {
		expect(() => roleStatements({ ...spec, reader: 'orders_reader' })).toThrow(
			ReaderNeedsPassword,
		);
	});
});

describe('role naming', () => {
	it('derives both names from the runtime role', () => {
		expect(ownerRole('orders')).toBe('orders_owner');
		expect(readerRole('orders')).toBe('orders_reader');
	});
});
