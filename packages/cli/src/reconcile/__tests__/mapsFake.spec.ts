import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { NotAFake, readMapsFakes } from '../fakes';

/**
 * A `Maps` construct's own fake, from `test/fakes/<id>.ts` — optional: one
 * with none is answered by the default fake featureTest serves.
 */

const root = join(import.meta.dirname, '__fixtures__', 'fakes');

const maps = (id: string) =>
	({
		kind: 'maps',
		id,
		apis: ['geocoding'],
		provides: [],
	}) as const;

describe('readMapsFakes', () => {
	it("reads a Maps's own fake, and skips one with none", async () => {
		const manifest = {
			Maps: maps('Maps'),
			Places: maps('Places'),
		} satisfies ConstructManifest;

		expect(await readMapsFakes(root, manifest)).toEqual([
			{ id: 'Maps', file: join(root, 'test', 'fakes', 'maps.ts') },
		]);
	});

	it('refuses a file whose default export is not an app fake', async () => {
		const manifest = {
			WrongMaps: maps('WrongMaps'),
		} satisfies ConstructManifest;

		await expect(readMapsFakes(root, manifest)).rejects.toBeInstanceOf(
			NotAFake,
		);
	});

	it('reads nothing of a construct that is not a Maps', async () => {
		const manifest = {
			Maps: {
				kind: 'credential',
				id: 'Maps',
				provides: ['MAPS_CREDENTIALS'],
			},
		} satisfies ConstructManifest;

		expect(await readMapsFakes(root, manifest)).toEqual([]);
	});
});
