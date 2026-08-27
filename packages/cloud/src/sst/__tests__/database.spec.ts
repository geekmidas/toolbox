import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { Database, DatabaseNeedsVpc } from '../aws/Database';
import { DatabaseReader, DatabaseSchema } from '../aws/DerivedDatabase';
import { type ProvisionContext, provisionerFor } from '../fromManifest';

const stack = {} as never;
const vpc = { id: 'stub-vpc' } as never;

const manifest = {
	Orders: {
		kind: 'database',
		id: 'Orders',
		engine: 'postgres',
		schema: 'app',
		provides: ['ORDERS_URL'],
	},
	OrdersReader: {
		kind: 'database-reader',
		id: 'OrdersReader',
		of: 'Orders',
		provides: ['ORDERS_READER_URL'],
	},
	AuthDb: {
		kind: 'database-schema',
		id: 'AuthDb',
		of: 'Orders',
		schema: 'authdb',
		provides: ['AUTH_DB_URL'],
	},
} as const satisfies ConstructManifest;

const cluster = () => new Database(stack, 'Orders', { vpc, schema: 'app' });

const context = (provisioned: Record<string, unknown>): ProvisionContext => ({
	manifest,
	provisioned: provisioned as never,
});

describe('Database', () => {
	it('composes one URL, the runtime role’s', () => {
		expect(Object.keys(cluster().provides())).toEqual(['url']);
	});

	it('puts search_path in as a libpq option, not a query parameter', () => {
		// A plain `?search_path=` is accepted by every URL parser, ignored by the
		// server, and produces a database that looks empty.
		const url = cluster().provides().url as string;

		expect(url).toContain('options=-c+search_path%3Dapp');
		expect(url).not.toMatch(/[?&]search_path=/);
	});

	it('refuses to invent a VPC', () => {
		// Creating one means creating a NAT gateway, which costs money in an
		// account whose networking may already be someone else's decision.
		expect(() =>
			provisionerFor('database')(stack, manifest.Orders, {}, context({})),
		).toThrow(DatabaseNeedsVpc);
	});
});

describe('DatabaseReader', () => {
	it('points at the endpoint the cluster already has', () => {
		// Nobody provisions a replica: `reader` is something an Aurora cluster
		// *has*, and where it runs one instance the endpoint resolves to it.
		const url = new DatabaseReader('OrdersReader', cluster()).provides()
			.url as string;

		expect(url).toContain('db-ro.stub.rds.amazonaws.com');
	});

	it('is reachable through the provisioner, from its parent', () => {
		const reader = provisionerFor('database-reader')(
			stack,
			manifest.OrdersReader,
			{},
			context({ Orders: cluster() }),
		);

		expect(reader.provides().url).toContain('db-ro.');
	});
});

describe('DatabaseSchema', () => {
	it('is the parent’s connection on a different search_path', () => {
		const url = new DatabaseSchema('AuthDb', cluster(), 'authdb').provides()
			.url as string;

		expect(url).toContain('options=-c+search_path%3Dauthdb');
		// The same host: a tenant is a schema inside the parent's database, not a
		// database of its own.
		expect(url).toContain('db.stub.rds.amazonaws.com');
	});

	it('resolves through a chain of derived nodes to the cluster', () => {
		const tenant = provisionerFor('database-schema')(
			stack,
			manifest.AuthDb,
			{},
			context({ Orders: cluster() }),
		);

		// A reader on a tenant walks up two links to reach the cluster.
		const readerOnTenant = provisionerFor('database-reader')(
			stack,
			{ kind: 'database-reader', id: 'AuthDbReader', of: 'AuthDb' },
			{},
			context({ Orders: cluster(), AuthDb: tenant }),
		);

		expect(readerOnTenant.provides().url).toContain('db-ro.');
	});
});
