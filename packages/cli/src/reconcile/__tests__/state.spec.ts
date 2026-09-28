import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { loadState, saveState } from '../state';

/**
 * What reconcile remembers between runs: the hash that lets a converged start
 * do nothing. Anything it cannot trust must read as "never reconciled", because
 * the cost of that is one slow start and the cost of the opposite is a stale
 * environment.
 */
describe('reconcile state', () => {
	let root: string;

	beforeEach(async () => {
		root = await createTempDir('gkm-reconcile-state-');
	});

	afterEach(async () => {
		await cleanupDir(root);
	});

	it('reads back what it saved, per stage', async () => {
		await saveState(root, { hash: 'abc', stage: 'dev' });
		await saveState(root, { hash: 'def', stage: 'test' });

		await expect(loadState(root, 'dev')).resolves.toEqual({
			hash: 'abc',
			stage: 'dev',
		});
		await expect(loadState(root, 'test')).resolves.toEqual({
			hash: 'def',
			stage: 'test',
		});
	});

	it('has nothing for a stage that never reconciled', async () => {
		await expect(loadState(root, 'dev')).resolves.toBeUndefined();
	});

	it('ignores a file that records a different stage', async () => {
		// Copied between stages by hand: `gkm test` must not skip what `gkm dev` did.
		await saveState(root, { hash: 'abc', stage: 'dev' });
		await copyFile(
			join(root, '.gkm', 'reconcile', 'dev.json'),
			join(root, '.gkm', 'reconcile', 'test.json'),
		);

		await expect(loadState(root, 'test')).resolves.toBeUndefined();
	});

	it('treats a corrupt file as never reconciled', async () => {
		await saveState(root, { hash: 'abc', stage: 'dev' });
		await writeFile(join(root, '.gkm', 'reconcile', 'dev.json'), '{ nope');

		await expect(loadState(root, 'dev')).resolves.toBeUndefined();
	});
});
