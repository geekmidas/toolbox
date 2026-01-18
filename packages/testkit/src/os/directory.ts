import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'vitest';

export const itWithDir = it.extend<DirectoryFixtures>({
	// This fixture automatically provides a transaction to each test
	// biome-ignore lint/correctness/noEmptyPattern: this has to be like this to satisfy Biome
	dir: async ({}, use) => {
		const tempDir = os.tmpdir();
		const directoryName = crypto.randomUUID().replace(/-/g, '').toUpperCase();
		const dir = path.join(tempDir, directoryName);
		await fs.mkdir(dir, { recursive: true });
		await use(dir);
		await fs.rm(dir, { recursive: true, force: true });

		// Clean up keystore directory that may have been created at ~/.gkm/{directoryName}
		const keystoreDir = path.join(os.homedir(), '.gkm', directoryName);
		await fs.rm(keystoreDir, { recursive: true, force: true });
	},
});

export interface DirectoryFixtures {
	dir: string;
}
