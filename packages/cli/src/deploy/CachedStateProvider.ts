/**
 * Cached State Provider
 *
 * Wraps a remote state provider (SSM) with local filesystem cache.
 * - Read: Local first, then remote if missing
 * - Write: Remote first, then update local cache
 *
 * This enables fast local development while keeping SSM as source of truth.
 */

import type { StateProvider } from './StateProvider';
import type { DokployStageState } from './state';

/**
 * Cached state provider that wraps a remote provider with local cache.
 */
export class CachedStateProvider implements StateProvider {
	constructor(
		private readonly remote: StateProvider,
		private readonly local: StateProvider,
	) {}

	async read(stage: string): Promise<DokployStageState | null> {
		// Try local cache first
		const localState = await this.local.read(stage);
		if (localState) {
			return localState;
		}

		// Fall back to remote
		const remoteState = await this.remote.read(stage);
		if (remoteState) {
			// Update local cache
			await this.local.write(stage, remoteState);
		}

		return remoteState;
	}

	async write(stage: string, state: DokployStageState): Promise<void> {
		// Write to remote first (source of truth)
		await this.remote.write(stage, state);

		// Update local cache
		await this.local.write(stage, state);
	}

	/**
	 * Force pull from remote to local.
	 * Used by `gkm state pull` command.
	 */
	async pull(stage: string): Promise<DokployStageState | null> {
		const remoteState = await this.remote.read(stage);
		if (remoteState) {
			await this.local.write(stage, remoteState);
		}
		return remoteState;
	}

	/**
	 * Force push from local to remote.
	 * Used by `gkm state push` command.
	 */
	async push(stage: string): Promise<DokployStageState | null> {
		const localState = await this.local.read(stage);
		if (localState) {
			await this.remote.write(stage, localState);
		}
		return localState;
	}

	/**
	 * Get both local and remote state for comparison.
	 * Used by `gkm state diff` command.
	 */
	async diff(
		stage: string,
	): Promise<{
		local: DokployStageState | null;
		remote: DokployStageState | null;
	}> {
		const [local, remote] = await Promise.all([
			this.local.read(stage),
			this.remote.read(stage),
		]);
		return { local, remote };
	}
}
