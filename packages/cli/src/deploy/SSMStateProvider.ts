/**
 * AWS SSM Parameter Store State Provider
 *
 * Stores deployment state as SecureString parameters in AWS SSM.
 * Uses AWS-managed KMS key for encryption (free tier).
 *
 * Parameter naming: /gkm/{workspaceName}/{stage}/state
 */

import {
	GetParameterCommand,
	ParameterNotFound,
	PutParameterCommand,
	SSMClient,
	type SSMClientConfig,
} from '@aws-sdk/client-ssm';
import type { AwsRegion, StateProvider } from './StateProvider';
import type { DokployStageState } from './state';

export interface SSMStateProviderOptions {
	/** Workspace name (used in parameter path) */
	workspaceName: string;
	/** AWS region */
	region?: AwsRegion;
	/** AWS credentials (optional - uses default credential chain if not provided) */
	credentials?: SSMClientConfig['credentials'];
	/** Custom endpoint (for LocalStack or other S3-compatible services) */
	endpoint?: string;
}

/**
 * AWS SSM Parameter Store state provider.
 *
 * Stores state as encrypted SecureString parameters.
 * Parameter path: /gkm/{workspaceName}/{stage}/state
 */
export class SSMStateProvider implements StateProvider {
	constructor(
		readonly workspaceName: string,
		private readonly client: SSMClient,
	) {}

	/**
	 * Create an SSMStateProvider with a new SSMClient.
	 */
	static create(options: SSMStateProviderOptions): SSMStateProvider {
		const client = new SSMClient({
			region: options.region,
			credentials: options.credentials,
			endpoint: options.endpoint,
		});

		return new SSMStateProvider(options.workspaceName, client);
	}

	/**
	 * Get the SSM parameter name for a stage.
	 */
	private getParameterName(stage: string): string {
		return `/gkm/${this.workspaceName}/${stage}/state`;
	}

	async read(stage: string): Promise<DokployStageState | null> {
		const parameterName = this.getParameterName(stage);

		try {
			const response = await this.client.send(
				new GetParameterCommand({
					Name: parameterName,
					WithDecryption: true,
				}),
			);

			if (!response.Parameter?.Value) {
				return null;
			}

			return JSON.parse(response.Parameter.Value) as DokployStageState;
		} catch (error) {
			// Parameter doesn't exist - return null (new deployment)
			if (error instanceof ParameterNotFound) {
				return null;
			}

			// Re-throw other errors (permission denied, network, etc.)
			throw error;
		}
	}

	async write(stage: string, state: DokployStageState): Promise<void> {
		const parameterName = this.getParameterName(stage);

		// Update last deployed timestamp
		state.lastDeployedAt = new Date().toISOString();

		await this.client.send(
			new PutParameterCommand({
				Name: parameterName,
				Value: JSON.stringify(state),
				Type: 'SecureString',
				Overwrite: true,
				Description: `GKM deployment state for ${this.workspaceName}/${stage}`,
			}),
		);
	}
}
