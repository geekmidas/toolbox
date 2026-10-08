/**
 * Applies a deployed stage's migrations, then runs its seeds, in a sandbox —
 * what `gkm seed` runs, against URLs the deploy hands it as secret files.
 *
 * Usage (by the Dokploy target's release, never by hand):
 *   node --import=<tsx> migrate-worker.ts '{"root":"…","stage":"…","manifest":{…},"patterns":[…]}'
 *
 * Migrations and seeds are the project's own code, which is why they run
 * here rather than in the deploy. Each owner URL arrives as a file in `GKM_SECRETS_DIR`,
 * named by its key, and is read into this process's memory only: never into
 * `process.env`, where a child the migration starts would inherit it.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import {
	migrateDatabases,
	SeedFailed,
	seedDatabases,
} from '../migrate/databases';
import { type ConstructSource, discover } from '../reconcile/discover';
import { SECRETS_DIR_ENV } from './sandbox';
import { answer, errorData, registerAdjacentTsconfig } from './workerRuntime';

/** Every secret file the sandbox mounted, by name. */
async function mountedSecrets(): Promise<Record<string, string>> {
	const dir = process.env[SECRETS_DIR_ENV];
	if (!dir) return {};

	const secrets: Record<string, string> = {};
	for (const name of await readdir(dir)) {
		secrets[name] = (await readFile(join(dir, name), 'utf8')).trim();
	}
	return secrets;
}

async function main(): Promise<void> {
	try {
		const request = JSON.parse(process.argv[2] ?? '{}') as {
			root: string;
			stage: string;
			manifest: ConstructManifest;
			patterns: string[];
		};
		await registerAdjacentTsconfig();

		// Where each construct is declared, so a migration runs with the Kysely
		// its own file resolves. The manifest itself is the deploy's: what it
		// provisioned is what gets migrated, not a second reading of the files.
		const sources: Record<string, ConstructSource> = {};
		if (request.patterns.length > 0) {
			await discover({
				patterns: request.patterns,
				cwd: request.root,
				sources,
			});
		}

		const options = {
			root: request.root,
			manifest: request.manifest,
			sources,
			env: await mountedSecrets(),
		};
		const runs = await migrateDatabases(options);
		// Every seed, every time, after the schema it was written for.
		const seeds = await seedDatabases({ ...options, stage: request.stage });

		answer({
			reason: 'migrated',
			runs: runs.map(({ target, applied }) => ({
				construct: target.id,
				migrations: target.migrations,
				applied,
			})),
			seeds: seeds.map(({ target, seeded }) => ({
				construct: target.id,
				seeds: target.seeds,
				seeded,
			})),
		});
	} catch (error) {
		// A seed's cause is the database's error — an Error, which `errorData`
		// leaves out — and it is what says what to fix.
		answer({
			reason: 'failed',
			error: {
				...errorData(error),
				...(error instanceof SeedFailed
					? { cause: errorData(error.cause) }
					: {}),
			},
		});
	}
}

void main();
