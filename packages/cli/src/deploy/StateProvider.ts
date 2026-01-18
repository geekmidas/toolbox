/**
 * State Provider Interface
 *
 * Abstracts the storage backend for deployment state.
 * Built-in providers: LocalStateProvider, SSMStateProvider
 * Users can also supply custom implementations.
 */

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
}

/**
 * Custom state provider config.
 */
export interface CustomStateConfig {
	/** Custom StateProvider implementation */
	provider: StateProvider;
}

/**
 * State configuration types.
 */
export type StateConfig = LocalStateConfig | SSMStateConfig | CustomStateConfig;

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

export interface CreateStateProviderOptions {
	/** State config from workspace */
	config?: StateConfig;
	/** Workspace root directory (for local provider) */
	workspaceRoot: string;
	/** Workspace name (for SSM parameter path) */
	workspaceName: string;
}

/**
 * Create a state provider based on configuration.
 *
 * - 'local': LocalStateProvider (default)
 * - 'ssm': CachedStateProvider with SSM as source of truth
 * - Custom: Use provided StateProvider implementation
 */
export async function createStateProvider(
	options: CreateStateProviderOptions,
): Promise<StateProvider> {
	const { config, workspaceRoot, workspaceName } = options;

	// Default to local provider if no config
	if (!config) {
		const { LocalStateProvider } = await import('./LocalStateProvider');
		return new LocalStateProvider(workspaceRoot);
	}

	// Custom provider implementation
	if (isStateProvider(config.provider)) {
		return config.provider;
	}

	// Built-in providers (discriminated by provider string)
	const provider = config.provider;

	if (provider === 'local') {
		const { LocalStateProvider } = await import('./LocalStateProvider');
		return new LocalStateProvider(workspaceRoot);
	}

	if (provider === 'ssm') {
		if (!workspaceName) {
			throw new Error(
				'Workspace name is required for SSM state provider. Set "name" in gkm.config.ts.',
			);
		}

		const { LocalStateProvider } = await import('./LocalStateProvider');
		const { SSMStateProvider } = await import('./SSMStateProvider');
		const { CachedStateProvider } = await import('./CachedStateProvider');

		const local = new LocalStateProvider(workspaceRoot);
		const ssm = SSMStateProvider.create({
			workspaceName,
			region: (config as SSMStateConfig).region,
		});

		return new CachedStateProvider(ssm, local);
	}

	// Should never reach here - custom providers handled above
	throw new Error(`Unknown state provider: ${JSON.stringify(config)}`);
}
