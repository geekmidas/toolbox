import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'vitest';

export const itWithDir = it.extend<DirectoryFixtures>({
	// This fixture automatically provides a transaction to each test
	dir: async (_, use) => {
		const tempDir = os.tmpdir();
		const directoryName = crypto.randomUUID().replace(/-/g, '').toUpperCase();
		const dir = path.join(tempDir, directoryName);
		await fs.mkdir(dir, { recursive: true });
		await use(dir);
		await fs.rm(dir, { recursive: true, force: true });
	},
});

export interface DirectoryFixtures {
	dir: string;
}
