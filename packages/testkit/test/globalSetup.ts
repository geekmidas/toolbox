import { Client } from 'pg';
import { POSTGRES_PORT } from './ports';
import { ensureServices } from './services';

/**
 * The variable a run's database name travels in, from this setup to the
 * workers. Vitest starts its workers after the global setups have run, and
 * they inherit the environment, so `TEST_DATABASE_CONFIG` below reads the
 * name this run created.
 */
const TEST_DATABASE_ENV = 'GKM_TEST_DATABASE';

/** Every run's database starts with this, followed by the run's pid. */
const RUN_DATABASE_PREFIX = 'geekmidas_test_';

export const TEST_DATABASE_CONFIG = {
	host: 'localhost',
	// Matches the override `docker-compose.yml` publishes the container on, so
	// the suite reaches the database it just started rather than whichever
	// other project happens to hold 5432.
	port: POSTGRES_PORT,
	user: 'geekmidas',
	password: 'geekmidas',
	database: process.env[TEST_DATABASE_ENV] ?? 'geekmidas_test',
};

const adminConfig = {
	host: TEST_DATABASE_CONFIG.host,
	port: TEST_DATABASE_CONFIG.port,
	user: TEST_DATABASE_CONFIG.user,
	password: TEST_DATABASE_CONFIG.password,
	database: 'postgres', // Connect to default postgres database
};

/** Whether the process that made a run's database is still running. */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: it exists, and belongs to someone else.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/**
 * A database of this run's own, dropped when the run ends.
 *
 * The Postgres container is shared by every checkout on the machine (the
 * compose project has one name), and this used to create and drop one fixed
 * `geekmidas_test`. Whichever run finished first dropped it from under every
 * other run still using it, and their suites failed with `database
 * "geekmidas_test" does not exist` — passing when rerun alone. Named after
 * the run's pid, a run only ever drops its own, and a run that was killed
 * before its teardown is swept by the next one, since its pid is gone.
 *
 * Several projects in one invocation (`vitest run --project cli --project
 * db`) each list this setup; the first creates the database and the rest
 * share it.
 */
export default async function globalSetup() {
	// Before connecting, not after failing to. This used to assume a Postgres
	// somebody had started by hand, and its absence took the whole project down
	// during collection — reporting no tests rather than a missing database.
	await ensureServices('postgres');

	if (process.env[TEST_DATABASE_ENV]) return;

	// Projects' setups may run side by side; the first one's creation is the
	// one every project waits on.
	const shared = globalThis as { [CREATING]?: Promise<string> };
	if (shared[CREATING]) {
		await shared[CREATING];
		return;
	}
	const creating = createRunDatabase();
	shared[CREATING] = creating;
	const name = await creating;
	process.env[TEST_DATABASE_ENV] = name;

	return async () => {
		delete process.env[TEST_DATABASE_ENV];
		delete shared[CREATING];
		const cleanupClient = new Client(adminConfig);
		try {
			await cleanupClient.connect();
			await cleanupClient.query(
				`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
			);
		} finally {
			await cleanupClient.end();
		}
	};
}

const CREATING = Symbol.for('geekmidas.testkit.runDatabase');

/**
 * Creates this run's database, first dropping any left by a run whose process
 * is gone.
 */
async function createRunDatabase(): Promise<string> {
	const name = `${RUN_DATABASE_PREFIX}${process.pid}`;
	const client = new Client(adminConfig);

	try {
		await client.connect();

		const { rows } = await client.query<{ datname: string }>(
			'SELECT datname FROM pg_catalog.pg_database WHERE datname LIKE $1',
			[`${RUN_DATABASE_PREFIX}%`],
		);
		for (const { datname } of rows) {
			const pid = Number(datname.slice(RUN_DATABASE_PREFIX.length));
			if (datname === name || !Number.isInteger(pid) || alive(pid)) continue;
			await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
		}

		await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
		await client.query(`CREATE DATABASE "${name}"`);
	} finally {
		await client.end();
	}

	return name;
}
