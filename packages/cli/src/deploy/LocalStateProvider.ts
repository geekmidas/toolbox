/**
 * Local Filesystem State Provider
 *
 * Stores deployment state in .gkm/deploy-{stage}.json files.
 * This is the default provider for local development.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StateProvider } from './StateProvider';
import type { DokployStageState } from './state';

/**
 * Get the state file path for a stage.
 */
function getStateFilePath(workspaceRoot: string, stage: string): string {
	return join(workspaceRoot, '.gkm', `deploy-${stage}.json`);
}

/**
 * Local filesystem state provider.
 *
 * Stores state in .gkm/deploy-{stage}.json files in the workspace root.
 */
export class LocalStateProvider implements StateProvider {
	constructor(private readonly workspaceRoot: string) {}

	async read(stage: string): Promise<DokployStageState | null> {
		const filePath = getStateFilePath(this.workspaceRoot, stage);

		try {
			const content = await readFile(filePath, 'utf-8');
			return JSON.parse(content) as DokployStageState;
		} catch (error) {
			// File doesn't exist - return null
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			// Log other errors but don't fail
			console.warn(`Warning: Could not read deploy state: ${error}`);
			return null;
		}
	}

	async write(stage: string, state: DokployStageState): Promise<void> {
		const filePath = getStateFilePath(this.workspaceRoot, stage);
		const dir = join(this.workspaceRoot, '.gkm');

		// Ensure .gkm directory exists
		await mkdir(dir, { recursive: true });

		// Update last deployed timestamp
		state.lastDeployedAt = new Date().toISOString();

		await writeFile(filePath, JSON.stringify(state, null, 2));
	}
}
