/**
 * Loads `gkm.config.ts` in a sandbox and answers with it as data.
 *
 * Usage (by `loadWorkspaceConfig` with a sandbox, never by hand):
 *   node --import=<tsx> config-worker.ts /path/to/gkm.config.ts
 *
 * Answers `{ reason: 'loaded', config }`, `{ reason: 'live', paths }` when the
 * config holds something JSON cannot carry, or `{ reason: 'failed', error }`
 * when it could not be loaded at all.
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
	answer,
	errorData,
	liveValuePaths,
	registerAdjacentTsconfig,
} from './workerRuntime';

async function load(configPath: string): Promise<unknown> {
	if (configPath.endsWith('.json')) {
		return JSON.parse(await readFile(configPath, 'utf8'));
	}
	const module = await import(pathToFileURL(configPath).href);
	return module.default;
}

async function main(): Promise<void> {
	const configPath = process.argv[2];
	try {
		if (!configPath) throw new TypeError('No config path was given.');
		await registerAdjacentTsconfig();
		const config = await load(configPath);
		const paths = liveValuePaths(config);
		answer(
			paths.length > 0
				? { reason: 'live', paths }
				: { reason: 'loaded', config },
		);
	} catch (error) {
		answer({ reason: 'failed', error: errorData(error) });
	}
}

void main();
