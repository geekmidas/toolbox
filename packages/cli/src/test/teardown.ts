/**
 * Dropping the test stage's databases when a suite ends.
 *
 * Reconcile never drops — the line it draws is at data. The test stage's data
 * is the exception: every test runs in a transaction rolled back after it, so
 * nothing in these databases is anyone's, and a database kept between runs is
 * one whose migrations already ran — an edited migration is never applied to
 * it again. So each run starts from a database it created, and drops it when
 * the suite ends: the Vitest global setup's teardown.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GkmError } from '../errors';
import type { SqlClient } from '../reconcile/provision';
import { quoteIdentifier } from '../reconcile/provision';
import { forgetState } from '../reconcile/state';
import { TEST_STAGE } from '../workspace/stages';
import { TEST_READY_FILE, type TestReady } from './ready';

/**
 * Drop the databases the last setup recorded, and forget the test stage's
 * reconcile, so the next run provisions them from nothing.
 *
 * A no-op when nothing is recorded — no run yet, or one already torn down —
 * so running it twice, or before a setup, is harmless.
 */
export async function dropTestDatabases(
	/** Where `gkm test` ran — its ready file is under it. */
	cwd: string,
	/** The workspace root, which holds the reconcile state. */
	root: string,
	/** A client on the shared cluster, as its superuser. */
	sql: (port: number) => SqlClient,
): Promise<string[]> {
	const readyPath = join(cwd, TEST_READY_FILE);
	const ready = await readReady(readyPath);
	const recorded = ready?.databases;
	if (!ready || !recorded) return [];

	const client = sql(recorded.port);
	for (const name of recorded.names) {
		// Recorded from the test stage's plan, so always suffixed — checked
		// anyway: the container is shared with the local stage, and this is the
		// one statement in the toolbox that deletes a developer's data.
		if (!name.endsWith(`_${TEST_STAGE}`)) {
			throw new NotATestDatabase(name);
		}
		// FORCE: a connection left open by the suite — a pool not yet ended —
		// would otherwise keep the database alive.
		await client.query(
			undefined,
			`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`,
		);
	}

	await forgetState(root, TEST_STAGE);
	const { databases: _dropped, ...rest } = ready;
	await writeFile(readyPath, JSON.stringify(rest, null, 2));

	return recorded.names;
}

async function readReady(path: string): Promise<TestReady | undefined> {
	try {
		return JSON.parse(await readFile(path, 'utf-8')) as TestReady;
	} catch {
		return undefined;
	}
}

/** A name recorded for the test stage without the test stage's suffix. */
export class NotATestDatabase extends GkmError {
	constructor(readonly database: string) {
		super(
			`Refusing to drop '${database}': only the test stage's databases (named ` +
				`'…_${TEST_STAGE}') are dropped after a suite. Delete ` +
				`${TEST_READY_FILE} if it was edited by hand.`,
		);
		this.name = 'NotATestDatabase';
	}
}
