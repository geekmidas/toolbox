/**
 * Discovers a project's constructs in a sandbox and answers with the
 * manifest as data.
 *
 * Usage (by `discover` under a sandbox, never by hand):
 *   node --import=<tsx> discover-worker.ts '{"patterns":[…],"cwd":"…"}'
 *
 * Discovery imports every construct module — the project's code — which is
 * why it runs here rather than in the deploy. Its warnings go to stderr, where
 * the host passes them on.
 */

import { discover } from '../reconcile/discover';
import {
	answer,
	errorData,
	liveValuePaths,
	registerAdjacentTsconfig,
} from './workerRuntime';

async function main(): Promise<void> {
	try {
		const request = JSON.parse(process.argv[2] ?? '{}') as {
			patterns: string[];
			cwd: string;
		};
		await registerAdjacentTsconfig();

		const runnables: Record<string, string[]> = {};
		const manifest = await discover({
			patterns: request.patterns,
			cwd: request.cwd,
			runnables,
		});

		const paths = liveValuePaths(manifest);
		answer(
			paths.length > 0
				? { reason: 'live', paths }
				: { reason: 'discovered', manifest, runnables },
		);
	} catch (error) {
		answer({ reason: 'failed', error: errorData(error) });
	}
}

void main();
