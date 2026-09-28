/**
 * A transaction per database, per test — as each runs deployed.
 *
 * An app's database and a schema tenant such as the auth server's are separate
 * databases to the code using them: separate connections, credentials, roles
 * and search paths. A test keeps them that way. Each gets its own connection,
 * opened into a transaction the first time the test touches it, and every one
 * is rolled back when the test ends.
 *
 * Code under test must be free to use transactions itself, and better-auth
 * does — it also calls `db.connection()`, which Kysely refuses on a
 * `Transaction`. So what a test hands over is not a `Transaction` but a Kysely
 * over the one connection already inside the test's transaction, on which a
 * `BEGIN` becomes a savepoint and a `COMMIT` releases it. Nothing the code does
 * can end the transaction the test will roll back.
 */

import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

/** How to reach one database: a URL, and its search path as a startup option. */
export interface ConnectionConfig {
	connectionString: string;
	options?: string;
}

/**
 * The connection settings for a database URL.
 *
 * `?search_path=` is not a libpq parameter: a URL carrying it connects and then
 * resolves every name against `public`. Postgres takes it as a startup option,
 * which is what a schema tenant's URL needs to reach its own tables.
 */
export function connectionConfig(url: string): ConnectionConfig {
	const parsed = new URL(url);
	const searchPath = parsed.searchParams.get('search_path');
	if (!searchPath) return { connectionString: url };

	parsed.searchParams.delete('search_path');
	return {
		connectionString: parsed.toString(),
		options: `-c search_path=${searchPath}`,
	};
}

/** One database's connection, inside a transaction the test will roll back. */
export interface BoundTransaction {
	/** Everything queried through this runs inside the test's transaction. */
	readonly db: Kysely<any>;
	/** Undo everything, and let the connection go. */
	rollback(): Promise<void>;
}

/** Open a connection to `url` and begin the transaction a test will roll back. */
export async function openBoundTransaction(
	url: string,
): Promise<BoundTransaction> {
	const client = new pg.Client(connectionConfig(url));
	await client.connect();
	await client.query('BEGIN');

	return {
		db: new Kysely({
			dialect: new PostgresDialect({
				// A "pool" of the one connection. Released never, ended never: the
				// test owns it, and it closes in `rollback`.
				pool: {
					connect: async () => savepointing(client),
					end: async () => {},
				} as unknown as pg.Pool,
			}),
		}),
		async rollback() {
			try {
				await client.query('ROLLBACK');
			} finally {
				await client.end();
			}
		},
	};
}

/**
 * The client, with transaction control turned into savepoints.
 *
 * Kysely issues `begin`/`commit`/`rollback` as plain statements; this is the
 * one place they can be caught. A depth counter names the savepoints, so
 * nested transactions nest.
 */
function savepointing(client: pg.Client): pg.PoolClient {
	let depth = 0;
	const query = client.query.bind(client) as (...args: unknown[]) => unknown;

	const wrapped = Object.create(client) as pg.PoolClient;
	Object.assign(wrapped, {
		query: (text: unknown, ...rest: unknown[]) => {
			const statement =
				typeof text === 'string' ? text.trim().toLowerCase() : undefined;

			if (statement === 'begin' || statement?.startsWith('start transaction')) {
				depth++;
				return query(`SAVEPOINT test_sp_${depth}`);
			}
			if (statement === 'commit') {
				return query(`RELEASE SAVEPOINT test_sp_${depth--}`);
			}
			if (statement === 'rollback') {
				return query(`ROLLBACK TO SAVEPOINT test_sp_${depth--}`);
			}
			return query(text, ...rest);
		},
		release: () => {},
	});
	return wrapped;
}

/**
 * The transactions one test has opened, by database.
 *
 * `get` opens a database's transaction the first time it is asked for and
 * hands back the same one after that — including to a caller that asks while
 * it is still opening. `rollbackAll` ends every one of them.
 */
export class TransactionRegistry<TKey = string> {
	private readonly open = new Map<TKey, Promise<BoundTransaction>>();

	get(key: TKey, url: string): Promise<Kysely<any>> {
		let transaction = this.open.get(key);
		if (!transaction) {
			transaction = openBoundTransaction(url);
			this.open.set(key, transaction);
		}
		return transaction.then(({ db }) => db);
	}

	async rollbackAll(): Promise<void> {
		const transactions = [...this.open.values()];
		this.open.clear();

		const results = await Promise.allSettled(
			transactions.map(async (transaction) => (await transaction).rollback()),
		);
		const failed = results.find(
			(result): result is PromiseRejectedResult => result.status === 'rejected',
		);
		if (failed) throw failed.reason;
	}
}
