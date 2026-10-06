/**
 * One behaviour, every backend: the suite each `StateStore` must pass.
 *
 * A harness opens stores onto one shared backend — two stores from it are two
 * runners of the same workspace (two CI jobs, a laptop and CI) — and can plant
 * a v1 state where the store will find it.
 */

import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	StageStateMissing,
	StateLocked,
	type StateStore,
	StateVersionConflict,
} from '../../StateStore';
import type { DokployStageState } from '../../state';

export interface StateStoreHarness {
	/** A new store on the shared backend: another runner. */
	open(): StateStore;
	/** Writes `body` where the store reads the stage's state, as v1 did. */
	seedV1(stage: string, body: string): Promise<void>;
	/** The v1 backup the store kept on migration, or null. */
	readV1Backup(stage: string): Promise<string | null>;
	/**
	 * False where the backend's create-if-absent is not atomic under a race,
	 * so two racing lock attempts may both lose. The local emulator's SSM is
	 * such a backend (both of two racing creates succeed a few times in a
	 * hundred); AWS's is not. The safety property — never two holders — is
	 * asserted either way.
	 */
	atomicCreate?: boolean;
}

export function dokployState(
	stage: string,
	overrides: Partial<DokployStageState> = {},
): DokployStageState {
	return {
		provider: 'dokploy',
		stage,
		projectId: 'proj_1',
		environmentId: 'env_1',
		applications: { api: 'app_api', web: 'app_web' },
		services: { postgresId: 'pg_1' },
		appCredentials: { api: { dbUser: 'api', dbPassword: 's3cret' } },
		lastDeployedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

/** Each test gets its own stage, so tests never see each other's state. */
function newStage(): string {
	return `stage-${randomUUID().slice(0, 8)}`;
}

export function stateStoreConformance(
	name: string,
	setup: () => Promise<StateStoreHarness>,
): void {
	describe(`${name} (StateStore conformance)`, () => {
		let harness: StateStoreHarness;
		let store: StateStore;

		beforeAll(async () => {
			harness = await setup();
			store = harness.open();
		});

		describe('read and write', () => {
			it('reads null for a stage that has no state', async () => {
				expect(await store.read(newStage())).toBeNull();
			});

			it('creates state and reads back what it wrote, at the version it returned', async () => {
				const stage = newStage();
				const state = dokployState(stage);

				const version = await store.write(stage, state, {
					expectedVersion: null,
				});

				expect(await store.read(stage)).toEqual({
					state,
					resources: {},
					version,
				});
			});

			it('refuses to create state that already exists', async () => {
				const stage = newStage();
				const version = await store.write(stage, dokployState(stage), {
					expectedVersion: null,
				});

				const error = await harness
					.open()
					.write(stage, dokployState(stage, { projectId: 'other' }), {
						expectedVersion: null,
					})
					.catch((e) => e);

				expect(error).toBeInstanceOf(StateVersionConflict);
				expect(error).toMatchObject({
					stage,
					expectedVersion: null,
					actualVersion: version,
				});
				expect((await store.read(stage))?.state.projectId).toBe('proj_1');
			});

			it('writes on top of the version it read, and moves the version on', async () => {
				const stage = newStage();
				const first = await store.write(stage, dokployState(stage), {
					expectedVersion: null,
				});

				const second = await store.write(
					stage,
					dokployState(stage, { projectId: 'proj_2' }),
					{ expectedVersion: first },
				);

				expect(second).not.toBe(first);
				expect(await store.read(stage)).toMatchObject({
					state: { projectId: 'proj_2' },
					version: second,
				});
			});

			it('raises StateVersionConflict for a write based on a stale version', async () => {
				const stage = newStage();
				const stale = await store.write(stage, dokployState(stage), {
					expectedVersion: null,
				});
				const current = await harness
					.open()
					.write(stage, dokployState(stage, { projectId: 'theirs' }), {
						expectedVersion: stale,
					});

				const error = await store
					.write(stage, dokployState(stage, { projectId: 'mine' }), {
						expectedVersion: stale,
					})
					.catch((e) => e);

				expect(error).toBeInstanceOf(StateVersionConflict);
				expect(error).toMatchObject({
					expectedVersion: stale,
					actualVersion: current,
				});
				expect((await store.read(stage))?.state.projectId).toBe('theirs');
			});

			it('lets exactly one of two runners writing on the same version succeed', async () => {
				const stage = newStage();
				const base = await store.write(stage, dokployState(stage), {
					expectedVersion: null,
				});

				const results = await Promise.allSettled(
					['a', 'b'].map((who) =>
						harness
							.open()
							.write(stage, dokployState(stage, { projectId: who }), {
								expectedVersion: base,
							}),
					),
				);

				const won = results.filter((r) => r.status === 'fulfilled');
				const lost = results.filter((r) => r.status === 'rejected');
				expect(won).toHaveLength(1);
				expect(lost).toHaveLength(1);
				expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(
					StateVersionConflict,
				);
			});
		});

		describe('resource records', () => {
			it('journals a resource as pending, then ready with its id', async () => {
				const stage = newStage();
				await store.write(stage, dokployState(stage), {
					expectedVersion: null,
				});

				await store.putResource(stage, {
					key: 'application:worker',
					type: 'application',
					status: 'pending',
				});
				expect(
					(await store.read(stage))?.resources['application:worker'],
				).toMatchObject({ status: 'pending' });

				const version = await store.putResource(stage, {
					key: 'application:worker',
					type: 'application',
					id: 'app_worker',
					status: 'ready',
					data: { name: 'worker' },
				});

				const stored = await store.read(stage);
				expect(stored?.version).toBe(version);
				expect(stored?.resources['application:worker']).toEqual({
					key: 'application:worker',
					type: 'application',
					id: 'app_worker',
					status: 'ready',
					data: { name: 'worker' },
					updatedAt: expect.any(String),
				});
			});

			it('keeps resource records when the state is rewritten', async () => {
				const stage = newStage();
				await store.write(stage, dokployState(stage), {
					expectedVersion: null,
				});
				const version = await store.putResource(stage, {
					key: 'redis',
					type: 'redis',
					id: 'redis_1',
					status: 'ready',
				});

				await store.write(stage, dokployState(stage, { projectId: 'p2' }), {
					expectedVersion: version,
				});

				expect((await store.read(stage))?.resources.redis?.id).toBe('redis_1');
			});

			it('deletes a resource record', async () => {
				const stage = newStage();
				await store.write(stage, dokployState(stage), {
					expectedVersion: null,
				});
				await store.putResource(stage, {
					key: 'redis',
					type: 'redis',
					id: 'redis_1',
					status: 'ready',
				});

				await store.deleteResource(stage, 'redis');

				expect((await store.read(stage))?.resources).toEqual({});
			});

			it('raises StateVersionConflict for a record based on a stale version', async () => {
				const stage = newStage();
				const stale = await store.write(stage, dokployState(stage), {
					expectedVersion: null,
				});
				await harness.open().putResource(stage, {
					key: 'redis',
					type: 'redis',
					status: 'pending',
				});

				await expect(
					store.putResource(
						stage,
						{ key: 'postgres', type: 'postgres', status: 'pending' },
						{ expectedVersion: stale },
					),
				).rejects.toBeInstanceOf(StateVersionConflict);
			});

			it('raises StageStateMissing for a record on a stage with no state', async () => {
				await expect(
					store.putResource(newStage(), {
						key: 'redis',
						type: 'redis',
						status: 'pending',
					}),
				).rejects.toBeInstanceOf(StageStateMissing);
			});
		});

		describe('lock', () => {
			it('lets exactly one of two racing runners take the lock', async () => {
				const stage = newStage();
				const runners = [harness.open(), harness.open()];

				const results = await Promise.allSettled(
					runners.map((runner) => runner.lock(stage, { operation: 'deploy' })),
				);

				const won = results.filter((r) => r.status === 'fulfilled');
				const lost = results.filter((r) => r.status === 'rejected');
				// Never two holders, on any backend.
				expect(won.length).toBeLessThanOrEqual(1);
				for (const loss of lost) {
					expect((loss as PromiseRejectedResult).reason).toBeInstanceOf(
						StateLocked,
					);
				}
				// Where creating is not atomic, both may have lost the race.
				if (harness.atomicCreate === false && won.length === 0) return;
				expect(won).toHaveLength(1);
				expect(lost).toHaveLength(1);

				const lock = (won[0] as PromiseFulfilledResult<any>).value;
				const error = (lost[0] as PromiseRejectedResult).reason;
				expect(error).toBeInstanceOf(StateLocked);
				expect(error.stage).toBe(stage);
				// The loser is told who holds it, so a person can decide
				// whether that run is still alive.
				expect(error.holder).toEqual(lock.holder);
				expect(error.holder).toMatchObject({
					pid: process.pid,
					operation: 'deploy',
				});
				expect(error.message).toContain(`gkm state:unlock --stage ${stage}`);

				await lock.release();
			});

			it('can be taken again once released', async () => {
				const stage = newStage();
				const first = await store.lock(stage);
				await first.release();

				const second = await harness.open().lock(stage);
				await second.release();
			});

			it('locks one stage, not every stage', async () => {
				const one = await store.lock(newStage());
				const other = await harness.open().lock(newStage());
				await one.release();
				await other.release();
			});

			it('force-unlocks a lock left behind, returning who held it', async () => {
				const stage = newStage();
				const abandoned = await store.lock(stage);

				expect(await harness.open().forceUnlock(stage)).toEqual(
					abandoned.holder,
				);
				expect(await harness.open().forceUnlock(stage)).toBeNull();
				const next = await harness.open().lock(stage);
				await next.release();
			});

			it("never releases another runner's lock", async () => {
				const stage = newStage();
				const abandoned = await store.lock(stage);
				await harness.open().forceUnlock(stage);
				const current = await harness.open().lock(stage);

				// The first holder comes back and releases what it thinks
				// is its lock.
				await abandoned.release();

				await expect(harness.open().lock(stage)).rejects.toBeInstanceOf(
					StateLocked,
				);
				await current.release();
			});
		});

		describe('v1 state', () => {
			it('migrates v1 on first read, keeping the original as a backup', async () => {
				const stage = newStage();
				const v1 = dokployState(stage, {
					services: { postgresId: 'pg_1', redisId: 'redis_1' },
				});
				const body = JSON.stringify(v1, null, 2);
				await harness.seedV1(stage, body);

				const stored = await store.read(stage);

				expect(stored?.state).toEqual(v1);
				// The ids v1 kept become records, so a journaled deploy adopts
				// them instead of creating them again.
				expect(stored?.resources).toMatchObject({
					project: { id: 'proj_1', status: 'ready' },
					environment: { id: 'env_1', status: 'ready' },
					'application:api': { id: 'app_api', status: 'ready' },
					'application:web': { id: 'app_web', status: 'ready' },
					postgres: { id: 'pg_1', status: 'ready' },
					redis: { id: 'redis_1', status: 'ready' },
				});
				expect(await harness.readV1Backup(stage)).toBe(body);

				// Migrated once: a second read is the same version, and the
				// version is good to write on.
				expect((await harness.open().read(stage))?.version).toBe(
					stored?.version,
				);
				await store.write(stage, v1, { expectedVersion: stored!.version });
			});
		});
	});
}
