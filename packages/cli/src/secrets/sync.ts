/**
 * Secrets Sync via AWS SSM Parameter Store
 *
 * Stores and retrieves encrypted StageSecrets as SecureString parameters.
 * Reuses the SSM infrastructure from the state provider.
 *
 * Parameter naming: /gkm/{workspaceName}/{stage}/secrets
 */

import {
	GetParameterCommand,
	ParameterNotFound,
	PutParameterCommand,
	SSMClient,
	type SSMClientConfig,
} from '@aws-sdk/client-ssm';
import type { SSMStateConfig } from '../deploy/StateProvider.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import type { StageSecrets } from './types.js';

/**
 * Get the SSM parameter name for secrets.
 */
function getSecretsParameterName(workspaceName: string, stage: string): string {
	return `/gkm/${workspaceName}/${stage}/secrets`;
}

/**
 * Create an SSM client from workspace state config.
 */
function createSSMClient(config: SSMStateConfig): SSMClient {
	const clientConfig: SSMClientConfig = {
		region: config.region,
	};

	if (config.profile) {
		const { fromIni } = require('@aws-sdk/credential-providers');
		clientConfig.credentials = fromIni({ profile: config.profile });
	}

	return new SSMClient(clientConfig);
}

/**
 * Push secrets to SSM Parameter Store.
 *
 * Stores the full StageSecrets object as a SecureString parameter.
 */
export async function pushSecrets(
	stage: string,
	workspace: NormalizedWorkspace,
): Promise<void> {
	const config = workspace.state;
	if (!config || config.provider !== 'ssm') {
		throw new Error(
			'SSM state provider not configured. Add state: { provider: "ssm", region: "..." } to gkm.config.ts.',
		);
	}

	if (!workspace.name) {
		throw new Error(
			'Workspace name is required for SSM secrets sync. Set "name" in gkm.config.ts.',
		);
	}

	const client = createSSMClient(config as SSMStateConfig);
	const parameterName = getSecretsParameterName(workspace.name, stage);

	const { readStageSecrets } = await import('./storage.js');
	const secrets = await readStageSecrets(stage, workspace.root);

	if (!secrets) {
		throw new Error(
			`No secrets found for stage "${stage}". Run "gkm secrets:init --stage ${stage}" first.`,
		);
	}

	await client.send(
		new PutParameterCommand({
			Name: parameterName,
			Value: JSON.stringify(secrets),
			Type: 'SecureString',
			Overwrite: true,
			Description: `GKM secrets for ${workspace.name}/${stage}`,
		}),
	);
}

/**
 * Pull secrets from SSM Parameter Store.
 *
 * @returns StageSecrets or null if no secrets are stored remotely
 */
export async function pullSecrets(
	stage: string,
	workspace: NormalizedWorkspace,
): Promise<StageSecrets | null> {
	const config = workspace.state;
	if (!config || config.provider !== 'ssm') {
		return null;
	}

	if (!workspace.name) {
		return null;
	}

	const client = createSSMClient(config as SSMStateConfig);
	const parameterName = getSecretsParameterName(workspace.name, stage);

	try {
		const response = await client.send(
			new GetParameterCommand({
				Name: parameterName,
				WithDecryption: true,
			}),
		);

		if (!response.Parameter?.Value) {
			return null;
		}

		return JSON.parse(response.Parameter.Value) as StageSecrets;
	} catch (error) {
		if (error instanceof ParameterNotFound) {
			return null;
		}
		throw error;
	}
}

/**
 * Check if SSM is configured for the workspace.
 */
export function isSSMConfigured(workspace: NormalizedWorkspace): boolean {
	return !!workspace.state && workspace.state.provider === 'ssm';
}
