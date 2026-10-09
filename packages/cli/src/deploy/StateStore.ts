/**
 * Deploy state store.
 *
 * `StateProvider` reads and writes a whole stage at once, with nothing to stop
 * two runs of the same stage from overwriting each other and nowhere to record
 * a resource the moment it exists. A `StateStore` adds the three things a
 * deploy needs to be safe against crashes and concurrent runs:
 *
 * - `lock(stage)`: one run per stage. A second gets `StateLocked`, naming the
 *   holder, instead of racing the first.
 * - Versioned `read` and conditional `write`: a write names the version it was
 *   based on, and raises `StateVersionConflict` when the stored state moved on
 *   underneath it, so nothing is lost silently even without the lock.
 * - Per-resource records: `putResource` journals one resource at a time, so a
 *   run that dies half way leaves behind the ids of everything it created.
 *
 * Built-in stores: `LocalStateStore`, `SSMStateStore`, `S3StateStore`. A
 * custom `StateProvider` is wrapped by `LegacyStateStore`, which keeps it
 * working but cannot lock.
 */

import { createHash, randomUUID } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { GkmError } from '../errors';
import {
	type CreateStateStoreConfig,
	isStateProvider,
	type S3StateConfig,
	type SSMStateConfig,
} from './StateProvider';
import type { DokployStageState } from './state';

/** Opaque: a file hash, an SSM parameter version or an S3 ETag. */
export type StateVersion = string;

/**
 * `pending` is written before the call that creates the resource, `ready`
 * once the target has returned its id. A run that finds a `pending` record
 * knows a previous run may have created the resource and should look for it
 * before creating another.
 */
export type ResourceStatus = 'pending' | 'ready';

export interface ResourceRecord {
	/** Unique within the stage, `<type>:<name>` — e.g. `application:api`. */
	key: string;
	/** What kind of resource it is — e.g. `application`, `postgres`. */
	type: string;
	/** The id the target gave it. Absent while `pending`. */
	id?: string;
	status: ResourceStatus;
	/** Whatever the target needs to adopt the resource on a later run. */
	data?: Record<string, unknown>;
	updatedAt: string;
}

/** A resource as a caller hands it to `putResource`; the store stamps it. */
export type ResourceInput = Omit<ResourceRecord, 'updatedAt'>;

export interface StoredStageState {
	state: DokployStageState;
	resources: Record<string, ResourceRecord>;
	/** Pass back as `expectedVersion` to write on top of exactly this read. */
	version: StateVersion;
}

export interface WriteOptions {
	/**
	 * The version this write is based on — `null` to create state that must
	 * not exist yet.
	 */
	expectedVersion: StateVersion | null;
}

export interface ResourceWriteOptions {
	/**
	 * Omitted, the record is applied on top of whatever is stored now (still
	 * conditionally, so a concurrent write raises rather than being lost).
	 */
	expectedVersion?: StateVersion;
}

export interface LockHolder {
	/** Unique per acquisition, so a release never removes someone else's lock. */
	id: string;
	owner: string;
	host: string;
	pid: number;
	acquiredAt: string;
	/** What the holder is doing, e.g. `deploy`. */
	operation?: string;
}

export interface LockOptions {
	operation?: string;
}

export interface StateLock {
	readonly stage: string;
	readonly holder: LockHolder;
	/** Removes the lock if it is still this one; safe to call twice. */
	release(): Promise<void>;
}

export interface StateStore {
	/** Takes the stage's lock, or raises `StateLocked` naming its holder. */
	lock(stage: string, options?: LockOptions): Promise<StateLock>;
	/**
	 * Removes the stage's lock whoever holds it, for a run that crashed with
	 * it held. Returns the holder it removed, or `null` if there was none.
	 */
	forceUnlock(stage: string): Promise<LockHolder | null>;
	read(stage: string): Promise<StoredStageState | null>;
	/** Replaces the stage's state, keeping its resource records. */
	write(
		stage: string,
		state: DokployStageState,
		options: WriteOptions,
	): Promise<StateVersion>;
	putResource(
		stage: string,
		record: ResourceInput,
		options?: ResourceWriteOptions,
	): Promise<StateVersion>;
	deleteResource(
		stage: string,
		key: string,
		options?: ResourceWriteOptions,
	): Promise<StateVersion>;
}

// ============================================================================
// Errors
// ============================================================================

export class StateLocked extends GkmError {
	constructor(
		readonly stage: string,
		readonly holder: LockHolder | null,
		readonly location: string,
	) {
		const by = holder
			? `${holder.owner}@${holder.host} (pid ${holder.pid}) since ${holder.acquiredAt}${holder.operation ? ` for '${holder.operation}'` : ''}`
			: 'a run that did not record who it was';
		super(
			`Deploy state for stage '${stage}' is locked by ${by} (${location}). ` +
				`Wait for that run to finish; if it crashed, release the lock with ` +
				`\`gkm state:unlock --stage ${stage}\`.`,
		);
		this.name = 'StateLocked';
	}
}

export class StateVersionConflict extends GkmError {
	constructor(
		readonly stage: string,
		readonly expectedVersion: StateVersion | null,
		readonly actualVersion: StateVersion | null,
	) {
		super(
			`Deploy state for stage '${stage}' changed since it was read ` +
				`(expected ${expectedVersion ? `version ${expectedVersion}` : 'no state'}, ` +
				`found ${actualVersion ? `version ${actualVersion}` : 'no state'}). ` +
				`Another run wrote it: read the state again and re-apply the change, ` +
				`and hold the stage's lock so runs take turns.`,
		);
		this.name = 'StateVersionConflict';
	}
}

export class StageStateMissing extends GkmError {
	constructor(readonly stage: string) {
		super(
			`There is no deploy state for stage '${stage}' to record a resource in. ` +
				`Write the stage's state first (write with expectedVersion: null).`,
		);
		this.name = 'StageStateMissing';
	}
}

export class StateUnreadable extends GkmError {
	constructor(
		readonly stage: string,
		readonly location: string,
		cause: unknown,
	) {
		super(
			`Deploy state for stage '${stage}' at ${location} is not valid JSON. ` +
				`Restore it from a backup (or the provider's history) rather than ` +
				`deploying without it — a deploy without state recreates every resource.`,
			{ cause },
		);
		this.name = 'StateUnreadable';
	}
}

export class StateSchemaTooNew extends GkmError {
	constructor(
		readonly stage: string,
		readonly schemaVersion: unknown,
	) {
		super(
			`Deploy state for stage '${stage}' has schema version ${String(schemaVersion)}, ` +
				`newer than this @geekmidas/cli understands (${STATE_SCHEMA_VERSION}). ` +
				`Upgrade @geekmidas/cli to the version that wrote it.`,
		);
		this.name = 'StateSchemaTooNew';
	}
}

/**
 * Not thrown: emitted (once per store) when a custom `StateProvider` stands
 * in for a store, so a deploy that cannot be protected from a concurrent one
 * says so.
 */
export class StateStoreWithoutLocking extends GkmError {
	constructor(readonly provider: string) {
		super(
			`The custom state provider '${provider}' has no lock and no versions, ` +
				`so two deploys of the same stage can still overwrite each other. ` +
				`Implement StateStore (lock, versioned read, conditional write) or ` +
				`use the 'local', 'ssm' or 's3' state provider.`,
		);
		this.name = 'StateStoreWithoutLocking';
	}
}

export class StateStoreNeedsWorkspaceName extends GkmError {
	constructor(readonly provider: string) {
		super(
			`The '${provider}' state provider keys state by workspace name. ` +
				`Set "name" in gkm.config.ts.`,
		);
		this.name = 'StateStoreNeedsWorkspaceName';
	}
}

export class UnknownStateProvider extends GkmError {
	constructor(readonly config: unknown) {
		super(
			`Unknown state provider ${JSON.stringify(config)}. Use 'local', 'ssm', ` +
				`'s3', or an object implementing StateStore or StateProvider.`,
		);
		this.name = 'UnknownStateProvider';
	}
}

/** A lock or write that could not get at the state backend in time. */
export class StateStoreBusy extends GkmError {
	constructor(
		readonly stage: string,
		readonly location: string,
	) {
		super(
			`Timed out waiting to write deploy state for stage '${stage}' (${location}). ` +
				`If no other gkm process is running, remove ${location}.`,
		);
		this.name = 'StateStoreBusy';
	}
}

// ============================================================================
// Document format
// ============================================================================

export const STATE_SCHEMA_VERSION = 2;

/**
 * What a store persists. v1 was `DokployStageState` on its own; v2 wraps it
 * so resource records and a write serial can sit beside it. The serial
 * changes every write, so content-addressed versions (a file hash, an S3
 * ETag) never repeat — a writer holding a version from two writes ago cannot
 * match by accident.
 */
export interface StateDocument {
	schemaVersion: typeof STATE_SCHEMA_VERSION;
	stage: string;
	serial: number;
	state: DokployStageState;
	resources: Record<string, ResourceRecord>;
	updatedAt: string;
}

export type DecodedDocument =
	| { schemaVersion: 2; document: StateDocument }
	| { schemaVersion: 1; state: DokployStageState };

export function decodeDocument(
	stage: string,
	body: string,
	location: string,
): DecodedDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (error) {
		throw new StateUnreadable(stage, location, error);
	}

	if (typeof parsed !== 'object' || parsed === null) {
		throw new StateUnreadable(stage, location, parsed);
	}

	const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
	if (schemaVersion === undefined) {
		return { schemaVersion: 1, state: parsed as DokployStageState };
	}
	if (schemaVersion === STATE_SCHEMA_VERSION) {
		return { schemaVersion: 2, document: parsed as StateDocument };
	}
	throw new StateSchemaTooNew(stage, schemaVersion);
}

export function encodeDocument(document: StateDocument): string {
	return JSON.stringify(document, null, 2);
}

/**
 * v1 state as a v2 document. The ids v1 kept are seeded as `ready` records,
 * so the first journaled deploy after an upgrade adopts them rather than
 * treating them as unknown.
 */
export function migrateV1(
	stage: string,
	state: DokployStageState,
): StateDocument {
	const now = new Date().toISOString();
	const resources: Record<string, ResourceRecord> = {};
	const seed = (type: string, name: string | null, id: string | undefined) => {
		if (!id) return;
		const key = name ? `${type}:${name}` : type;
		resources[key] = { key, type, id, status: 'ready', updatedAt: now };
	};

	seed('project', null, state.projectId);
	seed('environment', null, state.environmentId);
	for (const [app, id] of Object.entries(state.applications ?? {})) {
		seed('application', app, id);
	}
	seed('postgres', null, state.services?.postgresId);
	seed('redis', null, state.services?.redisId);
	seed('backup-destination', null, state.backups?.destinationId);

	return {
		schemaVersion: STATE_SCHEMA_VERSION,
		stage,
		serial: 1,
		state,
		resources,
		updatedAt: now,
	};
}

export function newLockHolder(options?: LockOptions): LockHolder {
	let owner = 'unknown';
	try {
		owner = userInfo().username;
	} catch {
		// No passwd entry (a container running as an arbitrary uid).
	}
	return {
		id: randomUUID(),
		owner,
		host: hostname(),
		pid: process.pid,
		acquiredAt: new Date().toISOString(),
		operation: options?.operation,
	};
}

export function contentVersion(body: string): StateVersion {
	return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

// ============================================================================
// Shared implementation
// ============================================================================

export interface RawState {
	body: string;
	version: StateVersion;
}

/**
 * A store over a backend that can read and conditionally write one blob per
 * stage, and create a lock object only if it does not exist. Migration and
 * resource records are the same for every such backend, so they live here.
 */
export abstract class DocumentStateStore implements StateStore {
	/** Where the stage's state lives, for messages. */
	protected abstract location(stage: string): string;
	protected abstract readRaw(stage: string): Promise<RawState | null>;
	/**
	 * Writes only if the stored version is `expectedVersion` (`null`: only if
	 * nothing is stored), else raises `StateVersionConflict`.
	 */
	protected abstract writeRaw(
		stage: string,
		body: string,
		expectedVersion: StateVersion | null,
	): Promise<StateVersion>;
	/** Keeps the v1 body as it was. Never replaces an existing backup. */
	protected abstract writeV1Backup(stage: string, body: string): Promise<void>;
	/** Creates the lock only if absent, else raises `StateLocked`. */
	protected abstract createLock(
		stage: string,
		holder: LockHolder,
	): Promise<void>;
	protected abstract readLock(stage: string): Promise<LockHolder | null>;
	/** Removes the lock — only if it is `holder`'s, when one is given. */
	protected abstract removeLock(
		stage: string,
		holder: LockHolder | null,
	): Promise<void>;

	async lock(stage: string, options?: LockOptions): Promise<StateLock> {
		const holder = newLockHolder(options);
		await this.createLock(stage, holder);
		let released = false;
		return {
			stage,
			holder,
			release: async () => {
				if (released) return;
				released = true;
				await this.removeLock(stage, holder);
			},
		};
	}

	async forceUnlock(stage: string): Promise<LockHolder | null> {
		const holder = await this.readLock(stage);
		await this.removeLock(stage, null);
		return holder;
	}

	async read(stage: string): Promise<StoredStageState | null> {
		const current = await this.readDocument(stage);
		if (!current) return null;
		return {
			state: current.document.state,
			resources: current.document.resources,
			version: current.version,
		};
	}

	async write(
		stage: string,
		state: DokployStageState,
		options: WriteOptions,
	): Promise<StateVersion> {
		if (options.expectedVersion === null) {
			const document: StateDocument = {
				schemaVersion: STATE_SCHEMA_VERSION,
				stage,
				serial: 1,
				state,
				resources: {},
				updatedAt: new Date().toISOString(),
			};
			return this.writeRaw(stage, encodeDocument(document), null);
		}
		return this.mutate(stage, options.expectedVersion, (document) => ({
			...document,
			state,
		}));
	}

	async putResource(
		stage: string,
		record: ResourceInput,
		options?: ResourceWriteOptions,
	): Promise<StateVersion> {
		return this.mutate(stage, options?.expectedVersion, (document) => ({
			...document,
			resources: {
				...document.resources,
				[record.key]: { ...record, updatedAt: new Date().toISOString() },
			},
		}));
	}

	async deleteResource(
		stage: string,
		key: string,
		options?: ResourceWriteOptions,
	): Promise<StateVersion> {
		return this.mutate(stage, options?.expectedVersion, (document) => {
			const { [key]: _removed, ...resources } = document.resources;
			return { ...document, resources };
		});
	}

	private async mutate(
		stage: string,
		expectedVersion: StateVersion | undefined,
		change: (document: StateDocument) => StateDocument,
	): Promise<StateVersion> {
		const current = await this.readDocument(stage);
		if (!current) {
			if (expectedVersion !== undefined) {
				throw new StateVersionConflict(stage, expectedVersion, null);
			}
			throw new StageStateMissing(stage);
		}
		if (expectedVersion !== undefined && current.version !== expectedVersion) {
			throw new StateVersionConflict(stage, expectedVersion, current.version);
		}

		const next = change(current.document);
		next.serial = current.document.serial + 1;
		next.updatedAt = new Date().toISOString();
		return this.writeRaw(stage, encodeDocument(next), current.version);
	}

	/**
	 * Reads the stage's document, migrating v1 in place on the way. The
	 * migration is itself a conditional write: if another run migrated (or
	 * wrote) first, its result is read instead.
	 */
	private async readDocument(
		stage: string,
		attempt = 0,
	): Promise<{ document: StateDocument; version: StateVersion } | null> {
		const raw = await this.readRaw(stage);
		if (!raw) return null;

		const decoded = decodeDocument(stage, raw.body, this.location(stage));
		if (decoded.schemaVersion === 2) {
			return { document: decoded.document, version: raw.version };
		}

		await this.writeV1Backup(stage, raw.body);
		const document = migrateV1(stage, decoded.state);
		try {
			const version = await this.writeRaw(
				stage,
				encodeDocument(document),
				raw.version,
			);
			return { document, version };
		} catch (error) {
			if (error instanceof StateVersionConflict && attempt < 2) {
				return this.readDocument(stage, attempt + 1);
			}
			throw error;
		}
	}
}

// ============================================================================
// Resolution
// ============================================================================

export function isStateStore(value: unknown): value is StateStore {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as StateStore).lock === 'function' &&
		typeof (value as StateStore).read === 'function' &&
		typeof (value as StateStore).write === 'function' &&
		typeof (value as StateStore).putResource === 'function'
	);
}

export interface CreateStateStoreOptions extends CreateStateStoreConfig {
	/** Where `StateStoreWithoutLocking` goes; `process.emitWarning` by default. */
	warn?: (warning: StateStoreWithoutLocking) => void;
}

/**
 * The store for a workspace's `state` config:
 *
 * - none / `'local'`: `LocalStateStore` under `.gkm/`
 * - `'ssm'`: `SSMStateStore`, with no local cache — SSM is read directly, so
 *   a stale local copy can never win over it
 * - `'s3'`: `S3StateStore`
 * - a `StateStore` object: used as is
 * - a `StateProvider` object: wrapped by `LegacyStateStore`
 */
export async function createStateStore(
	options: CreateStateStoreOptions,
): Promise<StateStore> {
	const { config, workspaceRoot, workspaceName } = options;

	if (!config || config.provider === 'local') {
		const { LocalStateStore } = await import('./LocalStateStore');
		return new LocalStateStore(workspaceRoot);
	}

	if (isStateStore(config.provider)) {
		return config.provider;
	}

	if (isStateProvider(config.provider)) {
		const { LegacyStateStore } = await import('./LegacyStateStore');
		return new LegacyStateStore(config.provider, { warn: options.warn });
	}

	if (config.provider === 'ssm') {
		if (!workspaceName) throw new StateStoreNeedsWorkspaceName('ssm');
		const { SSMStateStore } = await import('./SSMStateStore');
		const ssm = config as SSMStateConfig;
		return SSMStateStore.create({
			workspaceName,
			region: ssm.region,
			profile: ssm.profile,
		});
	}

	if (config.provider === 's3') {
		if (!workspaceName) throw new StateStoreNeedsWorkspaceName('s3');
		const { S3StateStore } = await import('./S3StateStore');
		const s3 = config as S3StateConfig;
		return S3StateStore.create({
			workspaceName,
			bucket: s3.bucket,
			prefix: s3.prefix,
			region: s3.region,
			profile: s3.profile,
		});
	}

	throw new UnknownStateProvider(config);
}
