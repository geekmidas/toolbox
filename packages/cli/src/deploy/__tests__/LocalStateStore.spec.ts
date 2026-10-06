import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	stat,
	utimes,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStateStore } from '../LocalStateStore';
import { StateSchemaTooNew, StateUnreadable } from '../StateStore';
import { dokployState } from './__helpers__/stateStoreConformance';

const STAGE = 'production';

/** Permission bits only — what `ls -l` shows. */
async function modeOf(path: string): Promise<number> {
	return (await stat(path)).mode & 0o777;
}

describe('LocalStateStore', () => {
	let root: string;
	let store: LocalStateStore;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-local-state-'));
		store = new LocalStateStore(root);
	});

	describe('file permissions', () => {
		it('writes state readable by its owner only', async () => {
			await store.write(STAGE, dokployState(STAGE), { expectedVersion: null });

			expect(await modeOf(store.statePath(STAGE))).toBe(0o600);
		});

		it('keeps the state 0600 across rewrites', async () => {
			const version = await store.write(STAGE, dokployState(STAGE), {
				expectedVersion: null,
			});
			await store.putResource(
				STAGE,
				{ key: 'redis', type: 'redis', status: 'pending' },
				{ expectedVersion: version },
			);

			expect(await modeOf(store.statePath(STAGE))).toBe(0o600);
		});

		it('writes the lock 0600', async () => {
			const lock = await store.lock(STAGE);

			expect(await modeOf(store.lockPath(STAGE))).toBe(0o600);
			await lock.release();
		});

		it('tightens a v1 file to 0600 when it migrates it, and writes the backup 0600', async () => {
			await mkdir(join(root, '.gkm'), { recursive: true });
			// v1 was written with the process umask — usually world-readable.
			await writeFile(
				store.statePath(STAGE),
				JSON.stringify(dokployState(STAGE)),
				{ mode: 0o644 },
			);

			await store.read(STAGE);

			expect(await modeOf(store.statePath(STAGE))).toBe(0o600);
			expect(await modeOf(store.backupPath(STAGE))).toBe(0o600);
		});
	});

	it('names the v1 backup deploy-<stage>.v1.json, beside the state', async () => {
		expect(store.backupPath(STAGE)).toBe(
			join(root, '.gkm', 'deploy-production.v1.json'),
		);
	});

	it('leaves no temp or mutex files behind after writing', async () => {
		const version = await store.write(STAGE, dokployState(STAGE), {
			expectedVersion: null,
		});
		await store.write(STAGE, dokployState(STAGE), { expectedVersion: version });

		expect(await readdir(join(root, '.gkm'))).toEqual([
			'deploy-production.json',
		]);
	});

	it('takes over a write mutex left by a process that died mid-write', async () => {
		await mkdir(join(root, '.gkm'), { recursive: true });
		const mutex = join(root, '.gkm', 'deploy-production.json.mutex');
		await writeFile(mutex, '');
		const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
		await utimes(mutex, anHourAgo, anHourAgo);

		await store.write(STAGE, dokployState(STAGE), { expectedVersion: null });

		expect((await store.read(STAGE))?.state.stage).toBe(STAGE);
	});

	it('raises StateUnreadable for a corrupt file instead of reading it as no state', async () => {
		// Reading a corrupt file as "no state" is how a deploy ends up
		// recreating every resource it already has.
		await mkdir(join(root, '.gkm'), { recursive: true });
		await writeFile(store.statePath(STAGE), '{ not json');

		await expect(store.read(STAGE)).rejects.toBeInstanceOf(StateUnreadable);
	});

	it('raises StateSchemaTooNew for state written by a newer CLI', async () => {
		await mkdir(join(root, '.gkm'), { recursive: true });
		await writeFile(
			store.statePath(STAGE),
			JSON.stringify({ schemaVersion: 3 }),
		);

		await expect(store.read(STAGE)).rejects.toBeInstanceOf(StateSchemaTooNew);
	});

	it('never replaces the v1 backup it kept first', async () => {
		await mkdir(join(root, '.gkm'), { recursive: true });
		await writeFile(store.backupPath(STAGE), 'the original');
		await writeFile(
			store.statePath(STAGE),
			JSON.stringify(dokployState(STAGE)),
		);

		await store.read(STAGE);

		expect(await readFile(store.backupPath(STAGE), 'utf-8')).toBe(
			'the original',
		);
	});
});
