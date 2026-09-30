/**
 * `gkm migrate` and `gkm migration` — applying a construct's migrations, and
 * writing its next one.
 *
 * Both work on a stage this machine reconciles: its containers up, its roles
 * provisioned, its owner URLs resolved. A deployed stage is migrated by the
 * deploy that ships it, which is the one thing that can reach its database.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EnvironmentParser } from '@geekmidas/envkit';
import {
	type ConstructManifest,
	canonicalId,
	type MigrationTarget,
	migrationTargets,
} from '@geekmidas/manifest';
import {
	type ServiceRegisterOptions,
	serviceContext,
} from '@geekmidas/services';
import { loadWorkspaceConfig } from '../config';
import { loadSecretsForApp } from '../credentials';
import { type ConstructSource, discover } from '../reconcile/discover';
import { constructGlobs, reconcileWorkspace } from '../reconcile/workspace.js';
import { TEST_STAGE } from '../workspace/stages';
import type { NormalizedWorkspace } from '../workspace/types.js';
import {
	migrateDatabases,
	NoSuchMigrationTarget,
	pendingMigrations,
} from './databases';
import { slug, stamp } from './names';

export {
	KyselyNotFound,
	MigrationFailed,
	type MigrationRun,
	migrateDatabases,
	NoOwnerCredential,
	NoSuchMigrationTarget,
	type PendingMigrations,
	pendingMigrations,
	UnknownMigrationFolder,
} from './databases';
export { slug, stamp } from './names';
export { DuplicateMigration, MigrationHasNoUp } from './provider';

const logger = console;

/** `gkm migrate --stage` named a stage only a deploy can reach. */
export class MigrateDeployedStage extends Error {
	constructor(
		readonly stage: string,
		readonly local: string,
	) {
		super(
			`'${stage}' is a deployed stage, and its database is migrated by ` +
				`\`gkm deploy --stage ${stage}\`, which is what can reach it. ` +
				`\`gkm migrate\` runs against '${local}' or '${TEST_STAGE}'.`,
		);
		this.name = 'MigrateDeployedStage';
	}
}

/** `gkm migration` for a Kysely database, with no name for the file. */
export class MigrationNeedsName extends Error {
	constructor(readonly construct: string) {
		super(
			`Name the migration: \`gkm migration ${construct} add_workouts\`. ` +
				`The name is what the file — and the history — calls it.`,
		);
		this.name = 'MigrationNeedsName';
	}
}

export interface MigrateOptions {
	/** The stage to migrate: the project's local one, or `test`. */
	stage?: string;
	/** One construct, by name. All of them when absent. */
	construct?: string;
}

/** A workspace's stage, reconciled and ready to migrate. */
export interface ReadyStage {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	sources: Record<string, ConstructSource>;
	/** Every URL the stage resolved — the owner URLs among them. */
	env: Record<string, string>;
}

/**
 * Reconcile a stage so it can be migrated: containers up, databases, schemas,
 * roles and grants in place, owner URLs resolved.
 *
 * Migrating assumes the roles exist, and this is what makes that true rather
 * than something a developer has to have run first.
 */
export async function readyStage(
	cwd: string,
	stage?: string,
): Promise<ReadyStage> {
	const { workspace } = await loadWorkspaceConfig(cwd);
	const local = workspace.stages.local;
	const target = stage ?? local;
	if (target !== local && target !== TEST_STAGE) {
		throw new MigrateDeployedStage(target, local);
	}

	const sources: Record<string, ConstructSource> = {};
	const manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
		sources,
	});

	const reconciled = await reconcileWorkspace(workspace, {
		stage: target,
		manifest,
		start: true,
	});

	return { workspace, manifest, sources, env: { ...reconciled.env } };
}

/** `gkm migrate [construct]`. */
export async function migrateCommand(
	options: MigrateOptions = {},
): Promise<void> {
	const ready = await readyStage(process.cwd(), options.stage);

	const runs = await migrateDatabases({
		root: ready.workspace.root,
		manifest: ready.manifest,
		sources: ready.sources,
		env: ready.env,
		...(options.construct ? { only: options.construct } : {}),
	});

	if (runs.length === 0) {
		logger.log('🗄️  No database constructs to migrate.');
		return;
	}

	for (const { target, applied } of runs) {
		if (applied.length === 0) {
			logger.log(`🗄️  ${target.folder}: up to date`);
			continue;
		}
		logger.log(`🗄️  ${target.folder}: applied ${applied.length}`);
		for (const name of applied) logger.log(`   ✓ ${name}`);
	}
}

/**
 * What `gkm dev` prints: one line per construct whose folder is ahead of its
 * history, and nothing when every folder is applied.
 *
 * Reported, never applied. A migration being written would otherwise run the
 * moment its file is saved, half-finished, against the database the developer
 * is working in.
 */
export async function reportPendingMigrations(
	workspace: NormalizedWorkspace,
	env: Readonly<Record<string, string>>,
): Promise<void> {
	const sources: Record<string, ConstructSource> = {};
	const manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
		sources,
	});

	const pending = await pendingMigrations({
		root: workspace.root,
		manifest,
		sources,
		env,
	});

	for (const { target, pending: names } of pending) {
		logger.log(
			`⚠️  ${target.folder}: ${names.length} pending (${names.join(', ')}) — run gkm migrate`,
		);
	}
}

export interface MigrationOptions {
	/** The construct the migration is for, by name. */
	construct: string;
	/** What the file is called, after its timestamp. */
	name?: string;
	/** The file's timestamp; the current time when absent. */
	now?: Date;
}

/**
 * `gkm migration <construct> [name]` — write the construct's next migration.
 *
 * For a database, an empty `up`/`down` to fill in. For an auth server, what
 * its schema is missing, computed against its tenant once every committed
 * migration has been applied — so the file is only the change, and is
 * reviewed and committed like any other.
 */
export async function migrationCommand(
	options: MigrationOptions,
): Promise<string | undefined> {
	const ready = await readyStage(process.cwd());
	const targets = migrationTargets(ready.manifest);
	const id = canonicalId(options.construct);

	const auth = authConstruct(ready.sources, id);
	if (auth) {
		const target = targets.find((t) => t.id === auth.databaseId);
		if (!target) {
			throw new NoSuchMigrationTarget(auth.databaseId, ids(targets));
		}
		return writeAuthMigration(ready, auth, target, options);
	}

	const target = targets.find((t) => t.id === id);
	if (!target) {
		throw new NoSuchMigrationTarget(options.construct, [
			...ids(targets),
			...authIds(ready.sources),
		]);
	}
	if (!options.name) throw new MigrationNeedsName(options.construct);

	const file = await write(
		ready.workspace.root,
		target,
		`${stamp(options.now)}_${slug(options.name)}.ts`,
		STUB,
	);
	logger.log(`📝 ${file}`);
	return file;
}

/** What an auth construct offers `gkm migration`, duck-typed across copies. */
interface AuthConstruct {
	id: string;
	databaseId: string;
	pendingMigration(
		options: ServiceRegisterOptions,
	): Promise<string | undefined>;
}

function authConstruct(
	sources: Readonly<Record<string, ConstructSource>>,
	id: string,
): AuthConstruct | undefined {
	const construct = sources[id]?.construct as
		| Partial<AuthConstruct>
		| undefined;
	return construct &&
		typeof construct.pendingMigration === 'function' &&
		typeof construct.databaseId === 'string'
		? (construct as AuthConstruct)
		: undefined;
}

function authIds(sources: Readonly<Record<string, ConstructSource>>): string[] {
	return Object.keys(sources).filter((id) => authConstruct(sources, id));
}

async function writeAuthMigration(
	ready: ReadyStage,
	auth: AuthConstruct,
	target: MigrationTarget,
	options: MigrationOptions,
): Promise<string | undefined> {
	// Against a tenant already at its committed migrations, so the comparison
	// finds only what the files do not yet say.
	await migrateDatabases({
		root: ready.workspace.root,
		manifest: ready.manifest,
		sources: ready.sources,
		env: ready.env,
		only: target.id,
	});

	// Its secret and URL come from the stage's secrets; the tenant's owner URL
	// from the reconcile above, which wins.
	const secrets = await loadSecretsForApp(
		ready.workspace.root,
		ready.workspace.stages.local,
	);
	const pending = await auth.pendingMigration({
		envParser: new EnvironmentParser({ ...secrets, ...ready.env }),
		context: serviceContext,
	});

	if (!pending) {
		logger.log(`✓ ${target.folder}: ${auth.id} is up to date`);
		return undefined;
	}

	const file = await write(
		ready.workspace.root,
		target,
		`${stamp(options.now)}_${slug(options.name ?? 'better_auth')}.sql`,
		`${pending.trim()}\n`,
	);
	logger.log(`📝 ${file}`);
	return file;
}

const STUB = `import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // await db.schema.createTable('…').addColumn(…).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // await db.schema.dropTable('…').execute();
}
`;

async function write(
	root: string,
	target: MigrationTarget,
	file: string,
	content: string,
): Promise<string> {
	const folder = join(root, target.folder);
	await mkdir(folder, { recursive: true });
	await writeFile(join(folder, file), content, { flag: 'wx' });
	return `${target.folder}/${file}`;
}

function ids(targets: readonly MigrationTarget[]): string[] {
	return targets.map((target) => target.id);
}
