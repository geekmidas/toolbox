/**
 * A custom `StateProvider` as a `StateStore`.
 *
 * A provider only reads and writes whole states, so this adapter can check a
 * version before it writes but cannot make the check and the write one step,
 * and cannot lock. It warns once (`StateStoreWithoutLocking`) the first time
 * a caller relies on either, and otherwise behaves as a store. Resource
 * records travel inside the state the provider stores, under `resources`.
 */

import type { StateProvider } from './StateProvider';
import {
	contentVersion,
	type LockHolder,
	type LockOptions,
	newLockHolder,
	type ResourceInput,
	type ResourceRecord,
	type ResourceWriteOptions,
	StageStateMissing,
	type StateLock,
	type StateStore,
	StateStoreWithoutLocking,
	type StateVersion,
	StateVersionConflict,
	type StoredStageState,
	type WriteOptions,
} from './StateStore';
import type { DokployStageState } from './state';

type ProviderState = DokployStageState & {
	resources?: Record<string, ResourceRecord>;
};

export interface LegacyStateStoreOptions {
	/** Where the warning goes; `process.emitWarning` by default. */
	warn?: (warning: StateStoreWithoutLocking) => void;
}

export class LegacyStateStore implements StateStore {
	private warned = false;
	private readonly warn: (warning: StateStoreWithoutLocking) => void;

	constructor(
		readonly provider: StateProvider,
		options: LegacyStateStoreOptions = {},
	) {
		this.warn = options.warn ?? ((warning) => process.emitWarning(warning));
	}

	async lock(stage: string, options?: LockOptions): Promise<StateLock> {
		this.warnOnce();
		return { stage, holder: newLockHolder(options), release: async () => {} };
	}

	async forceUnlock(_stage: string): Promise<LockHolder | null> {
		return null;
	}

	async read(stage: string): Promise<StoredStageState | null> {
		const stored = (await this.provider.read(stage)) as ProviderState | null;
		if (!stored) return null;
		const { resources = {}, ...state } = stored;
		return { state, resources, version: versionOf(stored) };
	}

	async write(
		stage: string,
		state: DokployStageState,
		options: WriteOptions,
	): Promise<StateVersion> {
		const current = await this.read(stage);
		this.check(stage, options.expectedVersion, current);
		return this.put(stage, { ...state, resources: current?.resources ?? {} });
	}

	async putResource(
		stage: string,
		record: ResourceInput,
		options?: ResourceWriteOptions,
	): Promise<StateVersion> {
		const current = await this.current(stage, options);
		return this.put(stage, {
			...current.state,
			resources: {
				...current.resources,
				[record.key]: { ...record, updatedAt: new Date().toISOString() },
			},
		});
	}

	async deleteResource(
		stage: string,
		key: string,
		options?: ResourceWriteOptions,
	): Promise<StateVersion> {
		const current = await this.current(stage, options);
		const { [key]: _removed, ...resources } = current.resources;
		return this.put(stage, { ...current.state, resources });
	}

	private async current(
		stage: string,
		options?: ResourceWriteOptions,
	): Promise<StoredStageState> {
		const current = await this.read(stage);
		if (options?.expectedVersion !== undefined) {
			this.check(stage, options.expectedVersion, current);
		}
		if (!current) throw new StageStateMissing(stage);
		return current;
	}

	private check(
		stage: string,
		expected: StateVersion | null,
		current: StoredStageState | null,
	): void {
		const actual = current?.version ?? null;
		if (actual !== expected) {
			throw new StateVersionConflict(stage, expected, actual);
		}
	}

	private async put(
		stage: string,
		state: ProviderState,
	): Promise<StateVersion> {
		this.warnOnce();
		// Providers stamp `lastDeployedAt` on the object they are given, so the
		// version is taken after the write, from what was actually stored.
		await this.provider.write(stage, state);
		return versionOf(state);
	}

	private warnOnce(): void {
		if (this.warned) return;
		this.warned = true;
		this.warn(
			new StateStoreWithoutLocking(
				this.provider.constructor?.name || 'anonymous',
			),
		);
	}
}

/** Key order is the provider's, so this is stable for a given stored state. */
function versionOf(state: ProviderState): StateVersion {
	return contentVersion(JSON.stringify(state));
}
