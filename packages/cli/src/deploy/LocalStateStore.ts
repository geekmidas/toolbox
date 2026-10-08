/**
 * Local filesystem state store.
 *
 * `.gkm/deploy-<stage>.json` holds the state, `.gkm/deploy-<stage>.lock` the
 * lock. Every file is mode 0600: state holds database passwords and IAM keys.
 */

import { randomUUID } from 'node:crypto';
import {
	link,
	mkdir,
	open,
	readFile,
	rename,
	rm,
	stat,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
	contentVersion,
	DocumentStateStore,
	type LockHolder,
	type RawState,
	StateLocked,
	StateStoreBusy,
	type StateVersion,
	StateVersionConflict,
} from './StateStore';

const FILE_MODE = 0o600;

/** How long a write waits for another process's write to finish. */
const MUTEX_TIMEOUT_MS = 5_000;
/**
 * A write holds the mutex for milliseconds, so one this old was left by a
 * process that died mid-write and is safe to take over.
 */
const MUTEX_STALE_MS = 30_000;

function isCode(error: unknown, code: string): boolean {
	return (error as NodeJS.ErrnoException)?.code === code;
}

export class LocalStateStore extends DocumentStateStore {
	constructor(readonly workspaceRoot: string) {
		super();
	}

	private get dir(): string {
		return join(this.workspaceRoot, '.gkm');
	}

	statePath(stage: string): string {
		return join(this.dir, `deploy-${stage}.json`);
	}

	lockPath(stage: string): string {
		return join(this.dir, `deploy-${stage}.lock`);
	}

	backupPath(stage: string): string {
		return join(this.dir, `deploy-${stage}.v1.json`);
	}

	private mutexPath(stage: string): string {
		return join(this.dir, `deploy-${stage}.json.mutex`);
	}

	protected location(stage: string): string {
		return this.statePath(stage);
	}

	protected async readRaw(stage: string): Promise<RawState | null> {
		try {
			const body = await readFile(this.statePath(stage), 'utf-8');
			return { body, version: contentVersion(body) };
		} catch (error) {
			if (isCode(error, 'ENOENT')) return null;
			throw error;
		}
	}

	protected async writeRaw(
		stage: string,
		body: string,
		expectedVersion: StateVersion | null,
	): Promise<StateVersion> {
		await this.ensureDir();
		return this.withMutex(stage, async () => {
			const current = await this.readRaw(stage);
			const actual = current?.version ?? null;
			if (actual !== expectedVersion) {
				throw new StateVersionConflict(stage, expectedVersion, actual);
			}

			// Written beside the target and renamed over it: a reader sees the
			// old file or the new one, never half of either.
			const target = this.statePath(stage);
			const temp = `${target}.${randomUUID()}.tmp`;
			try {
				const handle = await open(temp, 'wx', FILE_MODE);
				try {
					await handle.writeFile(body);
					await handle.sync();
				} finally {
					await handle.close();
				}
				await rename(temp, target);
			} catch (error) {
				await rm(temp, { force: true });
				throw error;
			}
			return contentVersion(body);
		});
	}

	protected async writeV1Backup(stage: string, body: string): Promise<void> {
		try {
			await writeFile(this.backupPath(stage), body, {
				flag: 'wx',
				mode: FILE_MODE,
			});
		} catch (error) {
			// The first migration's backup is the one worth keeping.
			if (!isCode(error, 'EEXIST')) throw error;
		}
	}

	protected async createLock(stage: string, holder: LockHolder): Promise<void> {
		await this.ensureDir();
		// Written whole, then linked into place: `link` fails if the lock
		// exists, so taking it is atomic — and a racing runner that loses never
		// reads a lock its winner has created but not yet written to.
		const lock = this.lockPath(stage);
		const temp = `${lock}.${randomUUID()}.tmp`;
		await writeFile(temp, JSON.stringify(holder, null, 2), {
			flag: 'wx',
			mode: FILE_MODE,
		});
		try {
			await link(temp, lock);
		} catch (error) {
			if (isCode(error, 'EEXIST')) {
				throw new StateLocked(stage, await this.readLock(stage), lock);
			}
			throw error;
		} finally {
			await unlink(temp).catch(() => {});
		}
	}

	protected async readLock(stage: string): Promise<LockHolder | null> {
		try {
			return JSON.parse(
				await readFile(this.lockPath(stage), 'utf-8'),
			) as LockHolder;
		} catch {
			// Missing, or created by a process that died before writing to it.
			return null;
		}
	}

	protected async removeLock(
		stage: string,
		holder: LockHolder | null,
	): Promise<void> {
		if (holder) {
			const current = await this.readLock(stage);
			if (current?.id !== holder.id) return;
		}
		await rm(this.lockPath(stage), { force: true });
	}

	private async ensureDir(): Promise<void> {
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
	}

	/**
	 * Serialises the check-then-rename of a conditional write across
	 * processes. The stage lock is for whole runs; this is for the instant of
	 * a single write, so even writers that skip the lock never interleave.
	 */
	private async withMutex<T>(stage: string, fn: () => Promise<T>): Promise<T> {
		const path = this.mutexPath(stage);
		const deadline = Date.now() + MUTEX_TIMEOUT_MS;

		for (;;) {
			try {
				const handle = await open(path, 'wx', FILE_MODE);
				await handle.close();
				break;
			} catch (error) {
				if (!isCode(error, 'EEXIST')) throw error;
				if (await this.isStale(path)) {
					await unlink(path).catch(() => {});
					continue;
				}
				if (Date.now() > deadline) throw new StateStoreBusy(stage, path);
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}

		try {
			return await fn();
		} finally {
			await rm(path, { force: true });
		}
	}

	private async isStale(path: string): Promise<boolean> {
		try {
			return Date.now() - (await stat(path)).mtimeMs > MUTEX_STALE_MS;
		} catch {
			return false;
		}
	}
}
