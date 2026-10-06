import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeployJournal } from '../journal';
import { LocalStateStore } from '../LocalStateStore';
import { StateVersionConflict } from '../StateStore';
import { createEmptyState } from '../state';

const STAGE = 'production';

/** A target holding named things, counting what it was asked to create. */
function target() {
	const things = new Map<string, { id: string; name: string }>();
	let next = 0;
	return {
		things,
		creates: 0,
		get: async (id: string) =>
			[...things.values()].find((thing) => thing.id === id) ?? null,
		find: async (name: string) => things.get(name) ?? null,
		create: async function (name: string) {
			this.creates++;
			const thing = { id: `id_${++next}`, name };
			things.set(name, thing);
			return thing;
		},
	};
}

describe('DeployJournal', () => {
	let root: string;
	let store: LocalStateStore;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-journal-'));
		store = new LocalStateStore(root);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const open = () =>
		DeployJournal.open(store, STAGE, () => createEmptyState(STAGE, '', ''));

	const steps = (t: ReturnType<typeof target>, name: string) => ({
		get: (id: string) => t.get(id),
		find: () => t.find(name),
		create: () => t.create(name),
		id: (thing: { id: string }) => thing.id,
	});

	const entry = { key: 'application:api', type: 'application' };

	it('writes a first state, so the first resource has somewhere to go', async () => {
		const journal = await open();

		expect(journal.existed).toBe(false);
		expect((await store.read(STAGE))?.state.stage).toBe(STAGE);
	});

	it('records pending before the create and ready with the id after', async () => {
		const t = target();
		const journal = await open();
		const seen: unknown[] = [];
		const create = t.create.bind(t);

		const ensured = await journal.ensure(entry, {
			...steps(t, 'api'),
			create: async () => {
				seen.push((await store.read(STAGE))?.resources[entry.key]?.status);
				return create('api');
			},
		});

		expect(seen).toEqual(['pending']);
		expect(ensured).toMatchObject({ via: 'created', resource: { id: 'id_1' } });
		expect((await store.read(STAGE))?.resources[entry.key]).toMatchObject({
			status: 'ready',
			id: 'id_1',
		});
	});

	it('resumes a pending resource by looking it up, never creating another', async () => {
		const t = target();
		// A run that died after the target created the resource.
		const dead = await open();
		await dead.pending(entry);
		await t.create('api');

		const journal = await open();
		expect(journal.unfinished()).toEqual(['application:api']);
		const ensured = await journal.ensure(entry, steps(t, 'api'));

		expect(ensured.via).toBe('resumed');
		expect(t.creates).toBe(1);
		expect(journal.unfinished()).toEqual([]);
	});

	it('creates a pending resource the dead run never got to', async () => {
		const t = target();
		const dead = await open();
		await dead.pending(entry);

		const ensured = await (await open()).ensure(entry, steps(t, 'api'));

		expect(ensured.via).toBe('created');
		expect(t.creates).toBe(1);
	});

	it('uses a recorded id, and says when the target no longer has it', async () => {
		const t = target();
		const first = await open();
		await first.ensure(entry, steps(t, 'api'));

		expect((await (await open()).ensure(entry, steps(t, 'api'))).via).toBe(
			'recorded',
		);

		t.things.clear();
		const again = await (await open()).ensure(entry, steps(t, 'api'));
		expect(again).toMatchObject({ via: 'created', staleId: 'id_1' });
	});

	it('raises when another writer changed the stage under it', async () => {
		const journal = await open();
		const current = await store.read(STAGE);
		await store.write(STAGE, createEmptyState(STAGE, 'theirs', ''), {
			expectedVersion: current!.version,
		});

		await expect(journal.save()).rejects.toBeInstanceOf(StateVersionConflict);
		await expect(journal.pending(entry)).rejects.toBeInstanceOf(
			StateVersionConflict,
		);
	});
});
