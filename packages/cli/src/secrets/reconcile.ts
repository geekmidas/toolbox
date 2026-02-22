import { generateFullstackCustomSecrets } from '../setup/fullstack-secrets.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import type { StageSecrets } from './types.js';

export interface ReconcileResult {
	/** The updated secrets with missing keys backfilled */
	secrets: StageSecrets;
	/** Keys that were added */
	addedKeys: string[];
}

/**
 * Reconcile missing custom secrets for a workspace.
 *
 * Compares current secrets against what generateFullstackCustomSecrets()
 * would produce and backfills any missing keys without overwriting
 * existing values.
 *
 * @returns ReconcileResult if keys were added, null if secrets are up-to-date
 */
export function reconcileMissingSecrets(
	secrets: StageSecrets,
	workspace: NormalizedWorkspace,
): ReconcileResult | null {
	const isMultiApp = Object.keys(workspace.apps).length > 1;
	if (!isMultiApp) {
		return null;
	}

	const expectedCustom = generateFullstackCustomSecrets(workspace);
	const addedKeys: string[] = [];
	const mergedCustom = { ...secrets.custom };

	for (const [key, value] of Object.entries(expectedCustom)) {
		if (!(key in mergedCustom)) {
			mergedCustom[key] = value;
			addedKeys.push(key);
		}
	}

	if (addedKeys.length === 0) {
		return null;
	}

	return {
		secrets: {
			...secrets,
			updatedAt: new Date().toISOString(),
			custom: mergedCustom,
		},
		addedKeys,
	};
}
