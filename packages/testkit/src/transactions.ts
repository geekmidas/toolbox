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
 *
 * A statement the code runs outside a transaction of its own gets a savepoint
 * too, so a failure — a duplicate key two concurrent requests raced to insert —
 * fails that statement alone, as it would deployed, rather than every request
 * the test makes after it.
 *
 * A savepoint the test or the code opens by name — `savepoint refused`, a
 * statement expected to fail, `rollback to savepoint refused` — is its own
 * transaction control, and passes through untouched. While one is open,
 * statements run in it as they would inside a `begin`: unwrapped, so a failure
 * aborts the transaction until the matching `rollback to savepoint`.
 */

import { Kysely, type KyselyConfig, PostgresDialect } from 'kysely';
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

/**
 * Open a connection to `url` and begin the transaction a test will roll back.
 *
 * `config` is what the database's own clients are built with — its plugins
 * above all. The code under test is handed this Kysely in place of its own, so
 * one built without them runs different queries than production does.
 */
export async function openBoundTransaction(
	url: string,
	config: Omit<KyselyConfig, 'dialect'> = {},
): Promise<BoundTransaction> {
	const client = new pg.Client(connectionConfig(url));
	await client.connect();
	await client.query('BEGIN');
	// Shared by every checkout of the connection: concurrent requests in one
	// test each check it out, and all of them take turns on it.
	const inTurn = turns();
	// The savepoints opened by name, shared by every checkout as the
	// connection's transaction is.
	const named: NamedSavepoint[] = [];

	return {
		db: new Kysely({
			...config,
			dialect: new PostgresDialect({
				// A "pool" of the one connection. Released never, ended never: the
				// test owns it, and it closes in `rollback`.
				pool: {
					connect: async () => savepointing(client, inTurn, named),
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
function savepointing(
	client: pg.Client,
	inTurn: Turns,
	named: NamedSavepoint[],
): pg.PoolClient {
	let depth = 0;
	const query = client.query.bind(client) as (
		...args: unknown[]
	) => Promise<unknown>;
	const wrapped = Object.create(client) as pg.PoolClient;

	// Ending one of the code's transactions ends every savepoint opened in it.
	const closeTransaction = (level: number) => {
		for (let i = named.length - 1; i >= 0; i--) {
			const savepoint = named[i]!;
			if (savepoint.checkout === wrapped && savepoint.depth >= level) {
				named.splice(i, 1);
			}
		}
	};

	Object.assign(wrapped, {
		query: (text: unknown, ...rest: unknown[]) => {
			// A cursor, a query config, a callback: not what Kysely sends for a
			// statement, and nothing to wrap.
			if (typeof text !== 'string' || typeof rest.at(-1) === 'function') {
				return query(text, ...rest);
			}
			const statement = text.trim().toLowerCase();

			if (statement === 'begin' || statement.startsWith('start transaction')) {
				const savepoint = `test_sp_${++depth}`;
				return inTurn(() => query(`SAVEPOINT ${savepoint}`));
			}
			if (statement === 'commit') {
				const level = depth--;
				closeTransaction(level);
				return inTurn(() => query(`RELEASE SAVEPOINT test_sp_${level}`));
			}
			if (statement === 'rollback') {
				const level = depth--;
				closeTransaction(level);
				return inTurn(() => query(`ROLLBACK TO SAVEPOINT test_sp_${level}`));
			}

			const control = savepointControl(text);
			if (control) {
				return inTurn(async () => {
					const result = await query(text, ...rest);
					track(named, control, { checkout: wrapped, depth });
					return result;
				});
			}
			if (depth > 0 || named.length > 0) {
				return inTurn(() => query(text, ...rest));
			}
			return inTurn(() => autocommitted(query, text, rest));
		},
		release: () => {},
	});
	return wrapped;
}

/** A savepoint the test or the code opened by name, and where it opened it. */
interface NamedSavepoint {
	name: string;
	/** The checkout, and its transaction depth, the savepoint was opened at. */
	checkout: pg.PoolClient;
	depth: number;
}

/** `SAVEPOINT x`, `RELEASE [SAVEPOINT] x`, `ROLLBACK [WORK] TO [SAVEPOINT] x`. */
interface SavepointControl {
	action: 'savepoint' | 'release' | 'rollback to';
	name: string;
}

const IDENTIFIER = String.raw`("(?:[^"]|"")+"|[^\s;"]+)`;
const SAVEPOINT_CONTROL: [SavepointControl['action'], RegExp][] = [
	['savepoint', new RegExp(String.raw`^savepoint\s+${IDENTIFIER}\s*;?$`, 'i')],
	[
		'release',
		new RegExp(
			String.raw`^release\s+(?:savepoint\s+)?${IDENTIFIER}\s*;?$`,
			'i',
		),
	],
	[
		'rollback to',
		new RegExp(
			String.raw`^rollback\s+(?:(?:work|transaction)\s+)?to\s+(?:savepoint\s+)?${IDENTIFIER}\s*;?$`,
			'i',
		),
	],
];

/**
 * The savepoint a statement opens, releases or rolls back to, named as
 * Postgres names it: an unquoted name folded to lower case, a quoted one as
 * written.
 */
function savepointControl(text: string): SavepointControl | undefined {
	const statement = text.trim();
	for (const [action, pattern] of SAVEPOINT_CONTROL) {
		const match = pattern.exec(statement);
		if (!match) continue;
		const identifier = match[1]!;
		const name = identifier.startsWith('"')
			? identifier.slice(1, -1).replaceAll('""', '"')
			: identifier.toLowerCase();
		return { action, name };
	}
	return undefined;
}

/**
 * Keep the named savepoints as Postgres does: `RELEASE x` ends x and every
 * savepoint after it; `ROLLBACK TO x` ends those after it and keeps x open.
 */
function track(
	named: NamedSavepoint[],
	control: SavepointControl,
	at: Omit<NamedSavepoint, 'name'>,
): void {
	if (control.action === 'savepoint') {
		named.push({ name: control.name, ...at });
		return;
	}
	const index = named.findLastIndex((s) => s.name === control.name);
	// One opened before this connection was handed over, or by a name the
	// wrapper uses itself: nothing tracked to end.
	if (index === -1) return;
	named.splice(control.action === 'release' ? index : index + 1);
}

/** Runs work in the order it was asked for, each after the last has settled. */
type Turns = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * One statement at a time on a connection, in the order they were asked for.
 *
 * The connection runs them one at a time anyway; this keeps a statement and
 * the savepoint around it together, so nothing another request sends lands
 * between them — a `RELEASE` also ends every savepoint opened after its own.
 */
function turns(): Turns {
	let queue: Promise<unknown> = Promise.resolve();
	return (work) => {
		const turn = queue.then(work, work);
		queue = turn.catch(() => {});
		return turn;
	};
}

/**
 * A statement run outside any transaction the code opened, failing the way
 * it would deployed: on its own.
 *
 * Deployed, such a statement is its own transaction, so one that fails — a
 * duplicate key two concurrent requests both tried to insert — fails alone,
 * and code written for that (Better Auth's rate limiter reads the row the
 * other request inserted, and carries on) does carry on. Inside the test's
 * transaction a failed statement would abort everything after it, every
 * request of the test included. A savepoint around it puts back what
 * deployed would have.
 */
async function autocommitted(
	query: (...args: unknown[]) => Promise<unknown>,
	text: string,
	rest: unknown[],
): Promise<unknown> {
	await query('SAVEPOINT test_statement');
	try {
		const result = await query(text, ...rest);
		await query('RELEASE SAVEPOINT test_statement');
		return result;
	} catch (error) {
		await query('ROLLBACK TO SAVEPOINT test_statement');
		await query('RELEASE SAVEPOINT test_statement');
		throw error;
	}
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

	get(
		key: TKey,
		url: string,
		config?: Omit<KyselyConfig, 'dialect'>,
	): Promise<Kysely<any>> {
		let transaction = this.open.get(key);
		if (!transaction) {
			transaction = openBoundTransaction(url, config);
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
