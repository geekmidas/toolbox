/**
 * A custom `StateProvider` as a `StateStore`.
 *
 * A provider only reads and writes whole states, so this adapter can check a
 * version before it writes but cannot make the check and the write one step,
 * and cannot lock. It warns once (`StateStoreWithoutLocking`) the first time
 * a caller relies on either, and otherwise behaves as a store. Resource
 * records travel inside the state the provider stores, under `resources`.
 */

import { currentActor } from './actor';
import type { StateProvider } from './StateProvider';
import {
	appendHistory,
	contentVersion,
	type HistoryEntry,
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
	upgradeV2State,
	type WriteOptions,
} from './StateStore';
import type { StageState } from './state';

type ProviderState = StageState & {
	resources?: Record<string, ResourceRecord>;
	history?: HistoryEntry[];
};

export interface LegacyStateStoreOptions {
	/** Where the warning goes; `process.emitWarning` by default. */
	warn?: (warning: StateStoreWithoutLocking) => void;
}

export class LegacyStateStore implements StateStore {
	private warned = false;
	/** The operation of the lock each stage is held for. */
	private readonly held = new Map<string, LockHolder>();
	private readonly logged = new Map<string, string>();
	private readonly warn: (warning: StateStoreWithoutLocking) => void;

	constructor(
		readonly provider: StateProvider,
		options: LegacyStateStoreOptions = {},
	) {
		this.warn = options.warn ?? ((warning) => process.emitWarning(warning));
	}

	async lock(stage: string, options?: LockOptions): Promise<StateLock> {
		this.warnOnce();
		const holder = newLockHolder(options);
		this.held.set(stage, holder);
		return {
			stage,
			holder,
			release: async () => {
				if (this.held.get(stage)?.id === holder.id) this.held.delete(stage);
			},
		};
	}

	async forceUnlock(_stage: string): Promise<LockHolder | null> {
		return null;
	}

	async read(stage: string): Promise<StoredStageState | null> {
		const stored = (await this.provider.read(stage)) as ProviderState | null;
		if (!stored) return null;
		const {
			resources: storedResources = {},
			history = [],
			...storedState
		} = stored;
		const { state, resources } =
			storedState.provider === 'dokploy'
				? upgradeV2State(storedState, storedResources)
				: { state: storedState as StageState, resources: storedResources };
		return { state, resources, history, version: versionOf(stored) };
	}

	async write(
		stage: string,
		state: StageState,
		options: WriteOptions,
	): Promise<StateVersion> {
		const current = await this.read(stage);
		this.check(stage, options.expectedVersion, current);
		return this.put(stage, current, {
			...state,
			resources: current?.resources ?? {},
		});
	}

	async putResource(
		stage: string,
		record: ResourceInput,
		options?: ResourceWriteOptions,
	): Promise<StateVersion> {
		const current = await this.current(stage, options);
		return this.put(stage, current, {
			...current.state,
			resources: {
				...current.resources,
				[record.key]: {
					...record,
					updatedAt: new Date().toISOString(),
					updatedBy: currentActor(),
				},
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
		return this.put(stage, current, { ...current.state, resources });
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
		current: StoredStageState | null,
		state: ProviderState,
	): Promise<StateVersion> {
		this.warnOnce();
		const holder = this.held.get(stage);
		const operation = holder?.operation ?? 'write';
		const history = current?.history ?? [];
		const sameRun =
			holder !== undefined &&
			this.logged.get(stage) === holder.id &&
			history[0]?.operation === operation;
		if (holder) this.logged.set(stage, holder.id);
		const serial = (history[0]?.serial ?? 0) + 1;
		state.history = appendHistory(
			history,
			{ serial, at: new Date().toISOString(), by: currentActor(), operation },
			sameRun,
		);
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
