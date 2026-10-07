/**
 * Loads a project's constructs in a sandbox and answers with what their
 * credentials schemas say, as data: each schema as JSON Schema, and whether
 * each value it was handed passes.
 *
 * Usage (by `inspectCredentials` under a sandbox, never by hand):
 *   node --import=<tsx> credentials-worker.ts '{"patterns":[…],"cwd":"…"}'
 *
 * The schemas are the project's code, which is why they run here. Each value
 * arrives as a file in `GKM_SECRETS_DIR` named by its key, is read into this
 * process's memory only, and never comes back: an answer carries issue paths
 * and messages, not values.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ConstructSource, discover } from '../reconcile/discover';
import { inspectLive, liveCredentials } from '../secrets/credentialSchemas';
import { SECRETS_DIR_ENV } from './sandbox';
import { answer, errorData, registerAdjacentTsconfig } from './workerRuntime';

/** Every secret file the sandbox mounted, by name. */
async function mountedSecrets(): Promise<Record<string, string>> {
	const dir = process.env[SECRETS_DIR_ENV];
	if (!dir) return {};

	const secrets: Record<string, string> = {};
	for (const name of await readdir(dir)) {
		secrets[name] = (await readFile(join(dir, name), 'utf8')).trim();
	}
	return secrets;
}

async function main(): Promise<void> {
	try {
		const request = JSON.parse(process.argv[2] ?? '{}') as {
			patterns: string[];
			cwd: string;
		};
		await registerAdjacentTsconfig();

		const sources: Record<string, ConstructSource> = {};
		const manifest = await discover({
			patterns: request.patterns,
			cwd: request.cwd,
			sources,
		});

		const inspection = await inspectLive(
			liveCredentials(manifest, sources),
			await mountedSecrets(),
		);
		answer({ reason: 'inspected', ...inspection });
	} catch (error) {
		answer({ reason: 'failed', error: errorData(error) });
	}
}

void main();
