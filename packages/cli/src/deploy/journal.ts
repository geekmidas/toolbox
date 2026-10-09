/**
 * A deploy's record of what it is creating, written as it goes.
 *
 * Deploy used to write state once, after every app had deployed, so a run that
 * failed half way lost the ids of everything it had created and the next run
 * fell back to finding them by name — or made them again. The journal writes
 * through the stage's `StateStore` after every resource instead:
 *
 * 1. `pending`, before the call that creates it — "this may now exist";
 * 2. `ready` with the target's id, once the call has returned.
 *
 * A run that meets a `pending` record looks the resource up before it creates
 * anything, so a run killed between the create and the record adopts what the
 * dead run made instead of making a second one. Every write is conditional on
 * the version the journal last wrote, so a writer that skipped the stage's
 * lock raises `StateVersionConflict` here rather than being overwritten.
 */

import type { ResourceRecord, StateStore, StateVersion } from './StateStore';
import type { StageState } from './state';

/** One resource, as the journal keys and describes it. */
export interface JournalEntry {
	/** `<type>:<name>`, unique within the stage — `application:api`. */
	key: string;
	type: string;
	/** What a later run needs to find it again — its name, usually. */
	data?: Record<string, unknown>;
}

/** How to get at one kind of resource on the target. */
export interface ResourceSteps<T> {
	/** By the id a `ready` record holds; `null` when the target lost it. */
	get?: (id: string) => Promise<T | null | undefined>;
	/** By what identifies it otherwise — its name, in its environment. */
	find: () => Promise<T | null | undefined>;
	create: () => Promise<T>;
	id: (resource: T) => string;
}

export interface Ensured<T> {
	resource: T;
	/**
	 * - `recorded`: the id in a `ready` record still resolves
	 * - `resumed`: a `pending` record's resource was found — a run died
	 *   between creating it and recording it
	 * - `found`: it existed, unrecorded
	 * - `created`: it did not exist
	 */
	via: 'recorded' | 'resumed' | 'found' | 'created';
	/** The recorded id that no longer resolved, if there was one. */
	staleId?: string;
}

export class DeployJournal<S extends StageState = StageState> {
	private constructor(
		private readonly store: StateStore,
		readonly stage: string,
		/** The stage's state, mutated by the deploy and written by `save`. */
		readonly state: S,
		private resources: Record<string, ResourceRecord>,
		private version: StateVersion,
		/** Whether the stage had state before this run. */
		readonly existed: boolean,
	) {}

	/**
	 * The stage's journal — its stored state, or `initial` written as the
	 * stage's first state, so there is somewhere to record the very first
	 * resource before it is created.
	 *
	 * `adopt` turns a stored state into the shape the caller works on — a
	 * Dokploy deploy of a stage compose deployed keeps its releases and starts
	 * its Dokploy ids afresh. Without it, the stored state is used as it is.
	 */
	static async open(
		store: StateStore,
		stage: string,
		initial: () => StageState,
	): Promise<DeployJournal<StageState>>;
	static async open<S extends StageState>(
		store: StateStore,
		stage: string,
		initial: () => S,
		adopt: (stored: StageState) => S,
	): Promise<DeployJournal<S>>;
	static async open(
		store: StateStore,
		stage: string,
		initial: () => StageState,
		adopt: (stored: StageState) => StageState = (stored) => stored,
	): Promise<DeployJournal<StageState>> {
		const stored = await store.read(stage);
		if (stored) {
			return new DeployJournal(
				store,
				stage,
				adopt(stored.state),
				stored.resources,
				stored.version,
				true,
			);
		}

		const state = initial();
		const version = await store.write(stage, state, { expectedVersion: null });
		return new DeployJournal(store, stage, state, {}, version, false);
	}

	record(key: string): ResourceRecord | undefined {
		return this.resources[key];
	}

	/** The keys a previous run marked `pending` and never saw created. */
	unfinished(): string[] {
		return Object.values(this.resources)
			.filter((record) => record.status === 'pending')
			.map((record) => record.key);
	}

	/** Records that `entry` is about to be created. */
	async pending(entry: JournalEntry): Promise<void> {
		await this.put({ ...entry, status: 'pending' });
	}

	/**
	 * Records `entry` as existing with `id`; a no-op if it already is, with
	 * the same data.
	 */
	async ready(entry: JournalEntry, id: string): Promise<void> {
		const current = this.resources[entry.key];
		if (
			current?.status === 'ready' &&
			current.id === id &&
			JSON.stringify(current.data) === JSON.stringify(entry.data)
		) {
			return;
		}
		await this.put({ ...entry, status: 'ready', id });
	}

	/**
	 * The resource `entry` names: by its recorded id, else by looking it up,
	 * else created — with `pending` written before the create and `ready`
	 * after, so a run that dies in between leaves a record the next run
	 * resolves by looking the resource up rather than creating another.
	 */
	async ensure<T>(
		entry: JournalEntry,
		steps: ResourceSteps<T>,
	): Promise<Ensured<T>> {
		const record = this.resources[entry.key];
		let staleId: string | undefined;

		if (record?.status === 'ready' && record.id && steps.get) {
			const known = await steps.get(record.id);
			if (known) {
				await this.ready(entry, steps.id(known));
				return { resource: known, via: 'recorded' };
			}
			staleId = record.id;
		}

		const existing = await steps.find();
		if (existing) {
			await this.ready(entry, steps.id(existing));
			return {
				resource: existing,
				via: record?.status === 'pending' ? 'resumed' : 'found',
				...(staleId ? { staleId } : {}),
			};
		}

		await this.pending(entry);
		const created = await steps.create();
		await this.ready(entry, steps.id(created));
		return {
			resource: created,
			via: 'created',
			...(staleId ? { staleId } : {}),
		};
	}

	/** Removes `key`'s record — a resource that no longer exists. */
	async forget(key: string): Promise<void> {
		if (!(key in this.resources)) return;
		this.version = await this.store.deleteResource(this.stage, key, {
			expectedVersion: this.version,
		});
		const { [key]: _removed, ...resources } = this.resources;
		this.resources = resources;
	}

	/** Every record, as the journal last wrote or read it. */
	records(): Record<string, ResourceRecord> {
		return this.resources;
	}

	/** Writes the stage's state, keeping its resource records. */
	async save(): Promise<void> {
		this.state.lastDeployedAt = new Date().toISOString();
		this.version = await this.store.write(this.stage, this.state, {
			expectedVersion: this.version,
		});
	}

	private async put(record: Omit<ResourceRecord, 'updatedAt'>): Promise<void> {
		this.version = await this.store.putResource(this.stage, record, {
			expectedVersion: this.version,
		});
		this.resources = {
			...this.resources,
			[record.key]: { ...record, updatedAt: new Date().toISOString() },
		};
	}
}
