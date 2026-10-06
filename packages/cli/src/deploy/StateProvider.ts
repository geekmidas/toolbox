/**
 * State configuration, and the `StateProvider` interface a custom backend can
 * implement.
 *
 * Deploy state is read and written through a `StateStore` (`StateStore.ts`):
 * locks, versions and resource records. A custom `StateProvider` — read and
 * write a whole state, nothing else — still works behind `LegacyStateStore`,
 * which warns that it cannot lock.
 */

import type { StateStore } from './StateStore';
import type { DokployStageState } from './state';

/**
 * Interface for deployment state storage providers.
 *
 * Implementations must handle:
 * - Reading state for a stage (returns null if not found)
 * - Writing state for a stage (creates or updates)
 */
export interface StateProvider {
	/**
	 * Read deployment state for a stage.
	 *
	 * @param stage - The deployment stage (e.g., 'development', 'production')
	 * @returns The state object or null if not found
	 */
	read(stage: string): Promise<DokployStageState | null>;

	/**
	 * Write deployment state for a stage.
	 *
	 * @param stage - The deployment stage
	 * @param state - The state object to persist
	 */
	write(stage: string, state: DokployStageState): Promise<void>;
}

/**
 * Valid AWS regions.
 */
export type AwsRegion =
	| 'us-east-1'
	| 'us-east-2'
	| 'us-west-1'
	| 'us-west-2'
	| 'af-south-1'
	| 'ap-east-1'
	| 'ap-south-1'
	| 'ap-south-2'
	| 'ap-southeast-1'
	| 'ap-southeast-2'
	| 'ap-southeast-3'
	| 'ap-southeast-4'
	| 'ap-northeast-1'
	| 'ap-northeast-2'
	| 'ap-northeast-3'
	| 'ca-central-1'
	| 'eu-central-1'
	| 'eu-central-2'
	| 'eu-west-1'
	| 'eu-west-2'
	| 'eu-west-3'
	| 'eu-south-1'
	| 'eu-south-2'
	| 'eu-north-1'
	| 'me-south-1'
	| 'me-central-1'
	| 'sa-east-1';

/**
 * Local state provider config.
 */
export interface LocalStateConfig {
	provider: 'local';
}

/**
 * SSM state provider config (requires region).
 */
export interface SSMStateConfig {
	provider: 'ssm';
	/** AWS region (required for SSM provider) */
	region: AwsRegion;
	/** AWS profile name (optional - uses default credential chain if not provided) */
	profile?: string;
}

/**
 * S3 state config: one object per stage, written with conditional puts
 * (`If-Match` / `If-None-Match`), and a lock object beside it.
 *
 * Keys: `<prefix>/<workspace name>/<stage>/state.json` and `lock.json`.
 */
export interface S3StateConfig {
	provider: 's3';
	/** Bucket the state lives in. It must already exist. */
	bucket: string;
	/** AWS region of the bucket */
	region: AwsRegion;
	/** Key prefix inside the bucket (default: `gkm`) */
	prefix?: string;
	/** AWS profile name (optional - uses default credential chain if not provided) */
	profile?: string;
}

/**
 * Custom state provider config.
 */
export interface CustomStateConfig {
	/**
	 * Custom implementation. A `StateStore` is used as is; a `StateProvider`
	 * still works, but cannot lock — deploy warns `StateStoreWithoutLocking`.
	 */
	provider: StateProvider | StateStore;
}

/**
 * State configuration types.
 */
export type StateConfig =
	| LocalStateConfig
	| SSMStateConfig
	| S3StateConfig
	| CustomStateConfig;

/**
 * Check if value is a StateProvider implementation.
 */
export function isStateProvider(value: unknown): value is StateProvider {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as StateProvider).read === 'function' &&
		typeof (value as StateProvider).write === 'function'
	);
}

export interface CreateStateStoreConfig {
	/** State config from workspace */
	config?: StateConfig;
	/** Workspace root directory (for local provider) */
	workspaceRoot: string;
	/** Workspace name (for SSM parameter path) */
	workspaceName: string;
}
