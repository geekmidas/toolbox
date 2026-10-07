/**
 * A deployed stage's migrations, applied by the deploy that ships it.
 *
 * Where they run is the question. A one-off container on the Dokploy server
 * would sit on the database's own network, but there is nothing to run one
 * with: an app's image holds its bundle and not `gkm` or the migration files,
 * and Dokploy has no job that runs to completion and reports an exit code —
 * an application is a service it restarts. So they run where the rest of
 * the project's code does, in the deploy's sandbox, and reach the cluster the
 * way the role DDL already does: through an external port the deploy
 * publishes for the duration and closes again.
 *
 * The owner URLs cross into the sandbox as secret files, never variables: a
 * migration is the project's code, and anything it spawns inherits its
 * environment.
 */

import { join } from 'node:path';
import {
	type ConstructManifest,
	migrationTargets,
	provideKey,
} from '@geekmidas/manifest';
import { z } from 'zod';
import { migrationFiles } from '../../migrate/provider';
import { LocalSandbox } from '../../sandbox/local';
import { activeSandbox, type Sandbox } from '../../sandbox/sandbox';
import { runWorker } from '../../sandbox/worker';

/** How long a stage's migrations may run before the deploy stops them. */
export const MIGRATIONS_TIMEOUT_MS = 15 * 60_000;

/** The migrations of a deployed stage failed; the release stopped before any app. */
export class DeployMigrationsFailed extends Error {
	constructor(
		readonly stage: string,
		/** The failure's class name in the sandbox — `MigrationFailed`, … */
		readonly reason: string,
		message: string,
	) {
		super(
			`Migrating "${stage}" failed, so no app was released: ${message}. ` +
				'Migrations applied before the failing one stay applied; fix it and deploy again.',
		);
		this.name = 'DeployMigrationsFailed';
	}
}

/** One construct's migrations, as the sandbox reports them. */
export interface AppliedMigrations {
	/** Its folder: `db/database/migrations`. */
	migrations: string;
	applied: string[];
}

/**
 * The URLs a stage's migrations connect with, keyed as the migrator reads
 * them, grouped by the database their cluster serves — for the targets that
 * have a migration to apply. Empty when none does, so a deploy publishes
 * nothing for a project that has not written one.
 */
export async function migrationUrls(
	root: string,
	manifest: ConstructManifest,
	env: Readonly<Record<string, string>>,
): Promise<Map<string, Record<string, string>>> {
	const byDatabase = new Map<string, Record<string, string>>();

	for (const target of migrationTargets(manifest)) {
		const files = await migrationFiles(join(root, target.migrations));
		if (files.size === 0) continue;

		// The owner's, and the runtime one a `roles: false` database migrates
		// with — whichever the migrator asks for is there.
		for (const role of ['ownerUrl', 'url']) {
			const key = provideKey(target.id, role);
			const url = env[key];
			if (!url) continue;

			const database = new URL(url).pathname.slice(1);
			byDatabase.set(database, { ...byDatabase.get(database), [key]: url });
		}
	}

	return byDatabase;
}

const answer = z.discriminatedUnion('reason', [
	z.object({
		reason: z.literal('migrated'),
		runs: z.array(
			z.object({ migrations: z.string(), applied: z.array(z.string()) }),
		),
	}),
	z.object({
		reason: z.literal('failed'),
		error: z.looseObject({ name: z.string(), message: z.string() }),
	}),
]);

export interface RunMigrationsOptions {
	root: string;
	stage: string;
	manifest: ConstructManifest;
	/** The constructs globs, for where each construct is declared. */
	patterns: readonly string[];
	/** The URLs to migrate with, reachable from where the sandbox runs. */
	urls: Readonly<Record<string, string>>;
	signal: AbortSignal;
	/** Defaults to the run's own, else a `LocalSandbox` on `root`. */
	sandbox?: Sandbox;
	timeoutMs?: number;
}

/** Apply every pending migration, in the sandbox, as each construct's owner. */
export async function runMigrations(
	options: RunMigrationsOptions,
): Promise<AppliedMigrations[]> {
	const sandbox =
		options.sandbox ??
		activeSandbox() ??
		new LocalSandbox({ root: options.root });

	const { value } = await runWorker(sandbox, 'migrations', {
		name: 'migrate-worker',
		args: [
			JSON.stringify({
				root: options.root,
				manifest: options.manifest,
				patterns: options.patterns,
			}),
		],
		cwd: options.root,
		timeoutMs: options.timeoutMs ?? MIGRATIONS_TIMEOUT_MS,
		secrets: options.urls,
		signal: options.signal,
		schema: answer,
	});

	if (value.reason === 'failed') {
		throw new DeployMigrationsFailed(
			options.stage,
			value.error.name,
			value.error.message,
		);
	}
	return value.runs;
}
