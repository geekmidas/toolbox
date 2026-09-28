import { describe, expect, it } from 'vitest';
import { memoryAdapter } from '../better-auth';

/**
 * What `memoryAdapter` offers beyond better-auth's contract: seeding a store,
 * reading it back, emptying it — and the orderings the conformance suites do
 * not reach, where the sorted field is missing on some rows.
 */

const now = new Date('2026-01-01T00:00:00Z');
const user = (id: string, name: string, image: string | null = null) => ({
	id,
	name,
	email: `${id}@example.test`,
	emailVerified: false,
	image,
	createdAt: now,
	updatedAt: now,
});

const open = (initialData?: Record<string, any[]>) => {
	const adapter = memoryAdapter({ initialData });
	return { adapter, db: adapter({}) };
};

describe('memoryAdapter store', () => {
	it('starts from the data it was seeded with', async () => {
		const { db } = open({ user: [user('u1', 'Ann')] });

		expect(
			await db.findOne({
				model: 'user',
				where: [{ field: 'id', value: 'u1' }],
			}),
		).toMatchObject({ id: 'u1', name: 'Ann' });
	});

	it('shows everything it holds, and empties on clear', async () => {
		const { adapter, db } = open({ user: [user('u1', 'Ann')] });
		await db.create({
			model: 'user',
			data: {
				name: 'Ben',
				email: 'ben@example.test',
				emailVerified: false,
				createdAt: now,
				updatedAt: now,
			},
		});

		const all = adapter.getAllData();
		expect(all.user!.map((row) => row.name).sort()).toEqual(['Ann', 'Ben']);
		// Written without an id, it was given one.
		expect(all.user!.every((row) => typeof row.id === 'string')).toBe(true);
		expect(adapter.getStore().size).toBe(1);

		adapter.clear();

		expect(adapter.getAllData()).toEqual({});
		expect(await db.findMany({ model: 'user', where: [] })).toEqual([]);
	});
});

describe('memoryAdapter ordering', () => {
	const { db } = open({
		user: [
			user('u1', 'Ann', 'b.png'),
			user('u2', 'Ben'),
			user('u3', 'Cat', 'a.png'),
			user('u4', 'Dan', 'a.png'),
		],
	});
	const names = (rows: { name: string }[]) => rows.map((row) => row.name);

	it('puts rows missing the field first ascending, and last descending', async () => {
		const ascending = await db.findMany<{ name: string }>({
			model: 'user',
			sortBy: { field: 'image', direction: 'asc' },
		});
		const descending = await db.findMany<{ name: string }>({
			model: 'user',
			sortBy: { field: 'image', direction: 'desc' },
		});

		expect(names(ascending)[0]).toBe('Ben');
		expect(names(ascending).slice(1, 3).sort()).toEqual(['Cat', 'Dan']);
		expect(names(ascending)[3]).toBe('Ann');
		expect(names(descending)[0]).toBe('Ann');
		expect(names(descending)[3]).toBe('Ben');
	});

	it('pages through a sorted result', async () => {
		const page = await db.findMany<{ name: string }>({
			model: 'user',
			sortBy: { field: 'name', direction: 'desc' },
			offset: 1,
			limit: 2,
		});

		expect(names(page)).toEqual(['Cat', 'Ben']);
	});

	it('matches either condition under OR', async () => {
		const rows = await db.findMany<{ name: string }>({
			model: 'user',
			where: [
				{ field: 'name', value: 'Ann' },
				{ field: 'name', value: 'Dan', connector: 'OR' },
			],
		});

		expect(names(rows).sort()).toEqual(['Ann', 'Dan']);
	});
});
