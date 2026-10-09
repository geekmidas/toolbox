/**
 * State Management CLI Commands
 *
 * Commands for managing deployment state across local and remote stores.
 *
 * Every command goes through a `StateStore`, the same one deploy writes
 * through: a v1 state is migrated on the way, resource records travel with
 * the state, and a copy is a conditional write — so `state:push` cannot
 * silently replace what a deploy wrote a moment earlier.
 */

import { loadWorkspaceConfig } from '../config';
import type { NormalizedWorkspace } from '../workspace/types';
import { describeActor } from './actor';
import { dnsResources } from './dnsResources';
import { LocalStateStore } from './LocalStateStore';
import {
	createStateStore,
	type HistoryEntry,
	type ResourceRecord,
	type StateStore,
	type StoredStageState,
} from './StateStore';
import type { DokployStageState, ReleasedImage, StageState } from './state';

/** What `state:show` prints in place of a secret. */
export const MASKED = '********';

/**
 * A copy of `state` with every secret replaced by `MASKED`: database
 * passwords, generated secrets and the backup IAM keys. `state:show` is run
 * to look up ids, in terminals and CI logs; nothing it prints should be
 * usable as a credential.
 */
export function maskStateSecrets<S extends StageState>(state: S): S {
	const masked: S = structuredClone(state);
	if (masked.provider !== 'dokploy') return masked;

	for (const credentials of Object.values(masked.appCredentials ?? {})) {
		credentials.dbPassword = MASKED;
	}
	for (const secrets of Object.values(masked.generatedSecrets ?? {})) {
		for (const name of Object.keys(secrets)) {
			secrets[name] = MASKED;
		}
	}
	if (masked.backups) {
		masked.backups.iamAccessKeyId = MASKED;
		masked.backups.iamSecretAccessKey = MASKED;
	}

	return masked;
}

export interface StateCommandOptions {
	stage: string;
}

/**
 * Pull state from remote to local.
 * `gkm state:pull --stage=<stage>`
 */
export async function statePullCommand(
	options: StateCommandOptions,
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();
	const { local, remote } = await remoteAndLocal(workspace);

	console.log(`Pulling state for stage: ${options.stage}...`);
	const pulled = await copyUnderLock(
		remote,
		local,
		local,
		options.stage,
		'state:pull',
	);

	if (pulled) {
		console.log('State pulled successfully.');
		printStateSummary(pulled.state);
	} else {
		console.log('No remote state found for this stage.');
	}
}

/**
 * Push local state to remote.
 * `gkm state:push --stage=<stage>`
 */
export async function statePushCommand(
	options: StateCommandOptions,
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();
	const { local, remote } = await remoteAndLocal(workspace);

	console.log(`Pushing state for stage: ${options.stage}...`);
	// Under the remote stage's lock: a push while a deploy of the stage runs
	// would replace the state that deploy is journaling into. It gets
	// `StateLocked` naming the deploy instead.
	const pushed = await copyUnderLock(
		local,
		remote,
		remote,
		options.stage,
		'state:push',
	);

	if (pushed) {
		console.log('State pushed successfully.');
		printStateSummary(pushed.state);
	} else {
		console.log('No local state found for this stage.');
	}
}

/**
 * Show current state.
 * `gkm state:show --stage=<stage>`
 */
export async function stateShowCommand(
	options: StateCommandOptions & { json?: boolean },
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();

	// The store deploy writes through — the remote one when there is one, read
	// directly, so a stale local copy is never what this shows.
	const store = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

	const stored = await store.read(options.stage);

	if (!stored) {
		console.log(`No state found for stage: ${options.stage}`);
		return;
	}

	const state = maskStateSecrets(stored.state);

	if (options.json) {
		console.log(JSON.stringify(state, null, 2));
	} else {
		printStateDetails(state);
		printDnsRecords(stored.resources);
		printUnfinished(stored.resources);
	}
}

/**
 * Release a stage's deploy lock, whoever holds it.
 * `gkm state:unlock --stage=<stage>`
 *
 * For a run that crashed with the lock held. Releasing a lock a live run
 * holds lets a second run race it, so the holder is printed for the caller
 * to check.
 */
export async function stateUnlockCommand(
	options: StateCommandOptions,
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();

	const store = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

	const holder = await store.forceUnlock(options.stage);

	if (!holder) {
		console.log(`Stage ${options.stage} was not locked.`);
		return;
	}

	console.log(
		`Released the lock on stage ${options.stage}, held by ${holder.owner}@${holder.host} (pid ${holder.pid}) since ${holder.acquiredAt}.`,
	);
}

/**
 * Compare local and remote state.
 * `gkm state:diff --stage=<stage>`
 */
export async function stateDiffCommand(
	options: StateCommandOptions,
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();
	const stores = await remoteAndLocal(workspace, [
		'Diff requires a remote provider to compare against.',
	]);

	console.log(`Comparing state for stage: ${options.stage}...\n`);
	const [localStored, remoteStored] = await Promise.all([
		stores.local.read(options.stage),
		stores.remote.read(options.stage),
	]);
	const local = localStored?.state ?? null;
	const remote = remoteStored?.state ?? null;

	if (!local && !remote) {
		console.log('No state found (local or remote).');
		return;
	}

	if (!local) {
		console.log('Local:  (none)');
	} else {
		console.log(`Local:  Last deployed ${local.lastDeployedAt}`);
	}

	if (!remote) {
		console.log('Remote: (none)');
	} else {
		console.log(`Remote: Last deployed ${remote.lastDeployedAt}`);
	}

	console.log('');

	// Compare applications
	const localApps = dokploy(local)?.applications ?? {};
	const remoteApps = dokploy(remote)?.applications ?? {};
	const allApps = new Set([
		...Object.keys(localApps),
		...Object.keys(remoteApps),
	]);

	if (allApps.size > 0) {
		console.log('Applications:');
		for (const app of allApps) {
			const localId = localApps[app];
			const remoteId = remoteApps[app];

			if (localId === remoteId) {
				console.log(`  ${app}: ${localId ?? '(none)'}`);
			} else if (!localId) {
				console.log(`  ${app}: (none) -> ${remoteId} [REMOTE ONLY]`);
			} else if (!remoteId) {
				console.log(`  ${app}: ${localId} -> (none) [LOCAL ONLY]`);
			} else {
				console.log(
					`  ${app}: ${localId} (local) != ${remoteId} (remote) [MISMATCH]`,
				);
			}
		}
	}

	// Compare services
	const localServices = dokploy(local)?.services ?? {};
	const remoteServices = dokploy(remote)?.services ?? {};

	if (
		Object.keys(localServices).length > 0 ||
		Object.keys(remoteServices).length > 0
	) {
		console.log('\nServices:');
		const serviceKeys = new Set([
			...Object.keys(localServices),
			...Object.keys(remoteServices),
		]);

		for (const key of serviceKeys) {
			const localVal = localServices[key as keyof typeof localServices];
			const remoteVal = remoteServices[key as keyof typeof remoteServices];

			if (localVal === remoteVal) {
				console.log(`  ${key}: ${localVal ?? '(none)'}`);
			} else {
				console.log(
					`  ${key}: ${localVal ?? '(none)'} (local) != ${remoteVal ?? '(none)'} (remote)`,
				);
			}
		}
	}

	// Resource records: only where the two disagree, since agreeing records
	// repeat the applications and services above.
	const localRecords = localStored?.resources ?? {};
	const remoteRecords = remoteStored?.resources ?? {};
	const differing = [
		...new Set([...Object.keys(localRecords), ...Object.keys(remoteRecords)]),
	].filter(
		(key) =>
			describeRecord(localRecords[key]) !== describeRecord(remoteRecords[key]),
	);

	if (differing.length > 0) {
		console.log('\nResources:');
		for (const key of differing) {
			console.log(
				`  ${key}: ${describeRecord(localRecords[key])} (local) != ${describeRecord(remoteRecords[key])} (remote)`,
			);
		}
	}
}

/**
 * The stage's local store and its remote one — or, for a workspace that keeps
 * state only locally, the reason there is nothing to move it between.
 */
async function remoteAndLocal(
	workspace: NormalizedWorkspace,
	hint: readonly string[] = [
		'Add a remote provider in gkm.config.ts:',
		'  state: { provider: "ssm", region: "us-east-1" }',
	],
): Promise<{ local: LocalStateStore; remote: StateStore }> {
	if (!workspace.state || workspace.state.provider === 'local') {
		console.error('No remote state provider configured.');
		for (const line of hint) console.error(line);
		process.exit(1);
	}

	return {
		local: new LocalStateStore(workspace.root),
		remote: await createStateStore({
			config: workspace.state,
			workspaceRoot: workspace.root,
			workspaceName: workspace.name,
		}),
	};
}

/**
 * Makes `to` hold exactly what `from` holds for `stage` — its state and its
 * resource records — while holding `locked`'s lock for the stage. Every
 * write is conditional on the version just read, so anything that changes
 * `to` mid-copy raises `StateVersionConflict` rather than being overwritten.
 */
async function copyUnderLock(
	from: StateStore,
	to: StateStore,
	locked: StateStore,
	stage: string,
	operation: string,
): Promise<StoredStageState | null> {
	const lock = await locked.lock(stage, { operation });
	try {
		return await copyStage(from, to, stage);
	} finally {
		await lock.release();
	}
}

/** @internal Exported for testing */
export async function copyStage(
	from: StateStore,
	to: StateStore,
	stage: string,
): Promise<StoredStageState | null> {
	const source = await from.read(stage);
	if (!source) return null;

	const target = await to.read(stage);
	let version = await to.write(stage, source.state, {
		expectedVersion: target?.version ?? null,
	});

	// The source's records, exactly: one only the target has describes a
	// resource the source does not know about, and keeping it would make the
	// copy something neither side wrote.
	for (const key of Object.keys(target?.resources ?? {})) {
		if (key in source.resources) continue;
		version = await to.deleteResource(stage, key, {
			expectedVersion: version,
		});
	}
	for (const { updatedAt: _stamped, ...record } of Object.values(
		source.resources,
	)) {
		version = await to.putResource(stage, record, {
			expectedVersion: version,
		});
	}

	return source;
}

/** `state` if Dokploy wrote it — the only shape with ids of its own. */
function dokploy(state: StageState | null): DokployStageState | null {
	return state?.provider === 'dokploy' ? state : null;
}

function describeRecord(record: ResourceRecord | undefined): string {
	if (!record) return '(none)';
	return record.id ? `${record.status} ${record.id}` : record.status;
}

/** Resources a run marked `pending` and never saw created. */
function printUnfinished(resources: Record<string, ResourceRecord>): void {
	const pending = Object.values(resources).filter(
		(record) => record.status === 'pending',
	);
	if (pending.length === 0) return;

	console.log('');
	console.log('Unfinished (a deploy stopped while creating these):');
	for (const record of pending) {
		console.log(`  ${record.key}`);
	}
}

function printStateSummary(state: StageState): void {
	if (state.provider !== 'dokploy') {
		console.log(`  Stage: ${state.stage} (${state.provider})`);
		console.log(`  Apps released: ${Object.keys(state.releases ?? {}).length}`);
		console.log(`  Last deployed: ${state.lastDeployedAt}`);
		return;
	}
	const appCount = Object.keys(state.applications).length;
	const hasPostgres = !!state.services.postgresId;
	const hasRedis = !!state.services.redisId;

	console.log(`  Stage: ${state.stage}`);
	console.log(`  Applications: ${appCount}`);
	console.log(`  Postgres: ${hasPostgres ? 'configured' : 'none'}`);
	console.log(`  Redis: ${hasRedis ? 'configured' : 'none'}`);
	console.log(`  Last deployed: ${state.lastDeployedAt}`);
}

function printStateDetails(state: StageState): void {
	if (state.provider !== 'dokploy') {
		console.log(`Stage: ${state.stage} (${state.provider})`);
		console.log(`Last Deployed: ${state.lastDeployedAt}`);
		if (state.identity) console.log(`Identity: ${state.identity}`);
		console.log('');
		printReleases(state.releases);
		return;
	}
	console.log(`Stage: ${state.stage}`);
	console.log(`Environment ID: ${state.environmentId}`);
	console.log(`Last Deployed: ${state.lastDeployedAt}`);
	console.log('');

	console.log('Applications:');
	const apps = Object.entries(state.applications);
	if (apps.length === 0) {
		console.log('  (none)');
	} else {
		for (const [name, id] of apps) {
			console.log(`  ${name}: ${id}`);
		}
	}
	console.log('');

	console.log('Services:');
	if (!state.services.postgresId && !state.services.redisId) {
		console.log('  (none)');
	} else {
		if (state.services.postgresId) {
			console.log(`  Postgres: ${state.services.postgresId}`);
		}
		if (state.services.redisId) {
			console.log(`  Redis: ${state.services.redisId}`);
		}
	}

	const credentials = Object.entries(state.appCredentials ?? {});
	if (credentials.length > 0) {
		console.log('');
		console.log('Database Credentials:');
		for (const [app, { dbUser, dbPassword }] of credentials) {
			console.log(`  ${app}: ${dbUser} / ${dbPassword}`);
		}
	}

	const generated = Object.entries(state.generatedSecrets ?? {});
	if (generated.length > 0) {
		console.log('');
		console.log('Generated Secrets:');
		for (const [app, secrets] of generated) {
			for (const [name, value] of Object.entries(secrets)) {
				console.log(`  ${app}.${name}: ${value}`);
			}
		}
	}

	if (state.backups) {
		console.log('');
		console.log('Backups:');
		console.log(`  Bucket: ${state.backups.bucketName}`);
		console.log(`  IAM User: ${state.backups.iamUserName}`);
		console.log(`  IAM Access Key: ${state.backups.iamAccessKeyId}`);
		console.log(`  IAM Secret Key: ${state.backups.iamSecretAccessKey}`);
	}

	if (state.dnsVerified && Object.keys(state.dnsVerified).length > 0) {
		console.log('');
		console.log('DNS Verified:');
		for (const [hostname, info] of Object.entries(state.dnsVerified)) {
			console.log(`  ${hostname}: ${info.serverIp} (${info.verifiedAt})`);
		}
	}
}

/** Each app's current release, and who released it. */
function printReleases(releases: StageState['releases']): void {
	console.log('Releases:');
	const apps = Object.entries(releases ?? {});
	if (apps.length === 0) {
		console.log('  (none)');
		return;
	}
	for (const [app, { current }] of apps) {
		console.log(`  ${app}: ${describeRelease(current)}`);
	}
}

/** `ghcr.io/acme/api:v2 (sha256:…) · 2026-… · ada@laptop` */
function describeRelease(release: ReleasedImage): string {
	return [
		`${release.ref}${release.digest ? ` (${release.digest})` : ''}`,
		release.releasedAt,
		describeActor(release.releasedBy),
	].join(' · ');
}

/** The DNS records gkm wrote for the stage. */
function printDnsRecords(resources: Record<string, ResourceRecord>): void {
	const records = dnsResources(resources);
	if (records.length === 0) return;
	console.log('');
	console.log('DNS Records:');
	for (const record of records) {
		console.log(
			`  ${record.fqdn} ${record.type} ${record.value} (TTL ${record.ttl}${record.provider ? `, ${record.provider}` : ''})`,
		);
	}
}

/** What `state:history --json` prints. */
export interface StateHistory {
	stage: string;
	/** Newest first. */
	history: HistoryEntry[];
	/** Each app's current release. */
	releases: Record<string, ReleasedImage>;
}

/**
 * Who wrote a stage's state, newest first, and what each app runs.
 * `gkm state:history --stage=<stage>`
 */
export async function stateHistoryCommand(
	options: StateCommandOptions & { json?: boolean },
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();
	const store = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

	const stored = await store.read(options.stage);
	if (!stored) {
		console.log(`No state found for stage: ${options.stage}`);
		return;
	}

	const history: StateHistory = {
		stage: options.stage,
		history: stored.history,
		releases: Object.fromEntries(
			Object.entries(stored.state.releases ?? {}).map(([app, releases]) => [
				app,
				releases.current,
			]),
		),
	};

	if (options.json) {
		console.log(JSON.stringify(history, null, 2));
		return;
	}

	console.log(`History of stage ${options.stage} (newest first):`);
	if (history.history.length === 0) {
		console.log('  (none recorded)');
	}
	for (const entry of history.history) {
		console.log(
			`  ${entry.serial} · ${entry.at} · ${describeActor(entry.by)} · ${entry.operation}`,
		);
	}
	console.log('');
	printReleases(stored.state.releases);
}
