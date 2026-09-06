/**
 * Type-level tests for what a reader is.
 *
 * A reader is terminal in the graph: `DERIVES_FROM` gives `cache` and
 * `database-schema` no `database-reader` parent, and there is no reader of a
 * reader. That has always been enforced by `assertDerivations` at build time —
 * these are the half that has to fail at *compile* time, because "a read-only
 * endpoint cannot own a table something writes to" is only a guarantee if the
 * wrong call does not build.
 *
 * Type-checked, never executed — `*.spec.ts` is excluded from the project
 * tsconfig and this is not, which is what makes a broken assertion here a
 * failing `tsc`.
 */

import { KyselyDatabase } from '../database/kysely';

type Expect<T extends true> = T;

interface OrdersDB {
	orders: { id: string };
}

const orders = new KyselyDatabase<OrdersDB, 'Orders'>('Orders');
const replica = orders.reader();

// The writer derives freely: a replica, a cache in the same database, and a
// tenant schema are all legitimate.
orders.reader();
orders.cache('Sessions');
orders.schema<{ sessions: { id: string } }, 'AuthDb'>('AuthDb');

// A reader derives nothing. Each of these is `assertDerivations`'s job today
// and a compile error now.
// @ts-expect-error a cache is written to, and a reader may not write
replica.cache('Sessions');

// @ts-expect-error a tenant owns tables, which a read-only endpoint cannot create
replica.schema<{ sessions: { id: string } }, 'AuthDb'>('AuthDb');

// @ts-expect-error there is no reader of a reader
replica.reader();

// What a reader keeps: it is still a construct, and it still hands out a
// client. Removing the deriving methods must not remove the point of it.
type ReaderIsAConstruct = Expect<
	typeof replica extends { declare: () => unknown } ? true : false
>;
type ReaderVendsAClient = Expect<
	typeof replica extends { service: unknown } ? true : false
>;

export type { ReaderIsAConstruct, ReaderVendsAClient };
