import { EnvironmentParser } from '@geekmidas/envkit';
import {
	assertDerivations,
	DEFAULT_POSTGRES_VERSION,
	InvalidConstructId,
	provisionOrder,
} from '@geekmidas/manifest';
import { serviceContext } from '@geekmidas/services';
import { CamelCasePlugin, Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { KyselyDatabase } from '../kysely';

/** Registers the construct's service against a real parser over real env. */
const connect = <DB, TName extends string>(
	construct: KyselyDatabase<DB, TName>,
	env: Record<string, string>,
) =>
	construct.service.register({
		envParser: new EnvironmentParser(env),
		context: serviceContext,
	});

interface OrdersDB {
	orders: { id: string; createdAt: Date };
}
interface AuthDB {
	sessions: { id: string };
}

describe('KyselyDatabase', () => {
	describe('identity', () => {
		it('canonicalises the id, so casing does not create two constructs', () => {
			expect(new KyselyDatabase('orders').id).toBe('Orders');
			expect(new KyselyDatabase('Orders').id).toBe('Orders');
		});

		it('derives the service key by uncapitalising the id', () => {
			expect(new KyselyDatabase('Orders').service.serviceName).toBe('orders');
		});

		it('rejects an id that cannot survive its derivations', () => {
			// `ConstructName<S>` rejects a bad *literal* at compile time, so this
			// has to arrive as a plain string — which is also the case that needs
			// the runtime guard: a JavaScript caller, or an id built at runtime.
			const id: string = '2fa';

			expect(() => new KyselyDatabase(id)).toThrow(InvalidConstructId);
		});

		it('exposes the service as a stable field, not a fresh object', () => {
			// Service discovery caches by object identity; a getter would never hit.
			const orders = new KyselyDatabase('Orders');
			expect(orders.service).toBe(orders.service);
		});
	});

	describe('declare', () => {
		it('declares a database, defaulting the schema to app', () => {
			expect(new KyselyDatabase('Orders').declare()).toEqual([
				{
					kind: 'database',
					id: 'Orders',
					engine: 'postgres',
					schema: 'app',
					// Always present, never inferred downstream: the container a
					// developer runs and the engine a deploy provisions both read
					// this one field, which is what stops them drifting apart.
					version: DEFAULT_POSTGRES_VERSION,
					provides: ['ORDERS_URL'],
				},
			]);
		});

		it('provides exactly one key — the runtime role', () => {
			// The owner URL is wired straight to the migrator by the adapter, so no
			// edge in any manifest can name it.
			const [declaration] = new KyselyDatabase('Orders').declare();

			expect(declaration?.provides).toEqual(['ORDERS_URL']);
		});

		it('carries a custom schema', () => {
			expect(
				new KyselyDatabase('Orders', { schema: 'sales' }).declare()[0],
			).toMatchObject({ schema: 'sales' });
		});

		it('stays quiet about roles unless downgraded', () => {
			expect(new KyselyDatabase('Orders').declare()[0]).not.toHaveProperty(
				'roles',
			);
			expect(
				new KyselyDatabase('Orders', { roles: false }).declare()[0],
			).toMatchObject({ roles: false });
		});
	});

	describe('reader', () => {
		it('names itself after its parent and declares the edge', () => {
			expect(new KyselyDatabase('Orders').reader().declare()).toEqual([
				{
					kind: 'database-reader',
					id: 'OrdersReader',
					of: 'Orders',
					provides: ['ORDERS_READER_URL'],
				},
			]);
		});

		it('gets its own service, so it can be depended on separately', () => {
			expect(new KyselyDatabase('Orders').reader().service.serviceName).toBe(
				'ordersReader',
			);
		});
	});

	describe('schema tenant', () => {
		it('declares a schema inside the parent database', () => {
			const orders = new KyselyDatabase<OrdersDB>('Orders');

			expect(orders.schema<AuthDB, 'Auth'>('Auth').declare()).toEqual([
				{
					kind: 'database-schema',
					id: 'Auth',
					of: 'Orders',
					schema: 'auth',
					provides: ['AUTH_URL'],
				},
			]);
		});

		it('takes an explicit schema name when given one', () => {
			expect(
				new KyselyDatabase('Orders')
					.schema('Jobs', { schema: 'pgboss' })
					.declare()[0],
			).toMatchObject({ schema: 'pgboss' });
		});
	});

	describe('as a manifest', () => {
		it('assembles into a manifest the derivation rules accept', () => {
			const orders = new KyselyDatabase<OrdersDB>('Orders');
			const auth = orders.schema<AuthDB, 'Auth'>('Auth');

			const manifest = Object.fromEntries(
				[orders, orders.reader(), auth, auth.reader()]
					.flatMap((c) => c.declare())
					.map((d) => [d.id, d]),
			);

			expect(() => assertDerivations(manifest)).not.toThrow();
			// Declared parent-first here, but ordering must hold regardless.
			expect(provisionOrder(manifest)).toEqual([
				'Orders',
				'OrdersReader',
				'Auth',
				'AuthReader',
			]);
		});
	});

	describe('kysely options', () => {
		it('passes plugins through to the client', async () => {
			const orders = new KyselyDatabase<OrdersDB, 'Orders'>('Orders', {
				plugins: [new CamelCasePlugin()],
			});

			const db = await connect(orders, {
				ORDERS_URL: 'postgres://app@localhost/orders',
			});

			// Proves the plugin reached the client rather than being dropped:
			// CamelCasePlugin is what rewrites `createdAt` to `created_at`.
			const { sql } = db.selectFrom('orders').select('createdAt').compile();
			expect(sql).toContain('created_at');
			await db.destroy();
		});

		it('reads the key it declared, and no other', async () => {
			// The stub this replaced answered every key with the same URL, so a
			// construct reading the wrong variable would have passed.
			const orders = new KyselyDatabase<OrdersDB, 'Orders'>('Orders');

			await expect(
				connect(orders, { DATABASE_URL: 'postgres://app@localhost/orders' }),
			).rejects.toThrow();
		});

		it('does not leak declaration options into the client', async () => {
			// `schema` and `roles` describe infrastructure; passing them to Kysely
			// would be meaningless at best.
			const orders = new KyselyDatabase<OrdersDB, 'Orders'>('Orders', {
				schema: 'sales',
				roles: false,
			});

			const db = await connect(orders, {
				ORDERS_URL: 'postgres://app@localhost/orders',
			});

			expect(db).toBeInstanceOf(Kysely);
			await db.destroy();
		});

		it('still declares schema and roles from the same object', () => {
			expect(
				new KyselyDatabase('Orders', {
					schema: 'sales',
					roles: false,
					plugins: [new CamelCasePlugin()],
				}).declare()[0],
			).toMatchObject({ schema: 'sales', roles: false });
		});
	});
});
