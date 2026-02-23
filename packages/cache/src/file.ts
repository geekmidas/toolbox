import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { addSeconds } from 'date-fns';
import lockfile from 'proper-lockfile';
import { type Cache, getExpirationInSeconds } from './';

interface FileCacheEntry {
	value: unknown;
	expiresAt: string;
}

type FileCacheData = Record<string, FileCacheEntry>;

export interface FileCacheOptions {
	/** Path to the cache JSON file. Default: `process.cwd()/.gkm/cache.json` */
	path?: string;
	/** Default TTL in seconds. Default: 600 */
	ttl?: number;
}

export class FileCache implements Cache {
	private readonly path: string;
	private readonly defaultTtl: number;
	/** In-process mutex to serialize concurrent writes within the same process. */
	private mutex: Promise<void> = Promise.resolve();

	constructor(options: FileCacheOptions = {}) {
		this.path = options.path ?? join(process.cwd(), '.gkm', 'cache.json');
		this.defaultTtl = options.ttl ?? 600;
	}

	async get<T>(key: string): Promise<T | undefined> {
		const data = await this.readData();
		const entry = data[key];
		if (!entry) return undefined;

		const remaining = getExpirationInSeconds(entry.expiresAt);
		if (remaining <= 0) {
			await this.withLock(async (current) => {
				delete current[key];
				return current;
			});
			return undefined;
		}

		return entry.value as T;
	}

	async set<T>(key: string, value: T, ttl?: number): Promise<void> {
		const seconds = ttl ?? this.defaultTtl;
		const expiresAt = addSeconds(new Date(), seconds).toISOString();

		await this.withLock(async (data) => {
			data[key] = { value, expiresAt };
			return data;
		});
	}

	async delete(key: string): Promise<void> {
		await this.withLock(async (data) => {
			delete data[key];
			return data;
		});
	}

	async ttl(key: string): Promise<number> {
		const data = await this.readData();
		const entry = data[key];
		if (!entry) return 0;

		return getExpirationInSeconds(entry.expiresAt);
	}

	private async readData(): Promise<FileCacheData> {
		try {
			const content = await readFile(this.path, 'utf-8');
			return JSON.parse(content) as FileCacheData;
		} catch {
			return {};
		}
	}

	private async ensureDir(): Promise<void> {
		const dir = dirname(this.path);
		if (!existsSync(dir)) {
			await mkdir(dir, { recursive: true });
		}
	}

	private async withLock(
		fn: (data: FileCacheData) => Promise<FileCacheData>,
	): Promise<void> {
		// Queue behind any pending in-process operations
		const prev = this.mutex;
		let resolve: () => void;
		this.mutex = new Promise<void>((r) => {
			resolve = r;
		});

		try {
			await prev;
			await this.ensureDir();

			// Ensure file exists before locking (proper-lockfile requires it)
			if (!existsSync(this.path)) {
				await writeFile(this.path, '{}');
			}

			const release = await lockfile.lock(this.path, {
				retries: { retries: 3, minTimeout: 100, maxTimeout: 1000 },
				stale: 10000,
			});

			try {
				const data = await this.readData();
				const updated = await fn(data);
				await writeFile(this.path, JSON.stringify(updated, null, 2));
			} finally {
				await release();
			}
		} finally {
			resolve!();
		}
	}
}
