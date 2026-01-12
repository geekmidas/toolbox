import { getDokployToken } from '../auth';
import type { DeployResult, DokployDeployConfig } from './types';

const logger = console;

export interface DokployDeployOptions {
	/** Deployment stage */
	stage: string;
	/** Image tag */
	tag: string;
	/** Image reference */
	imageRef: string;
	/** Master key from build */
	masterKey?: string;
	/** Dokploy config from gkm.config */
	config: DokployDeployConfig;
}

interface DokployErrorResponse {
	message: string;
	code?: string;
	issues?: Array<{ message: string }>;
}

/**
 * Get the Dokploy API token from stored credentials or environment
 */
async function getApiToken(): Promise<string> {
	const token = await getDokployToken();
	if (!token) {
		throw new Error(
			'Dokploy credentials not found.\n' +
				'Run "gkm login --service dokploy" to authenticate, or set DOKPLOY_API_TOKEN.',
		);
	}
	return token;
}

/**
 * Make a request to the Dokploy API
 */
async function dokployRequest<T>(
	endpoint: string,
	baseUrl: string,
	token: string,
	body: Record<string, unknown>,
): Promise<T> {
	const url = `${baseUrl}/api/${endpoint}`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		let errorMessage = `Dokploy API error: ${response.status} ${response.statusText}`;

		try {
			const errorBody = (await response.json()) as DokployErrorResponse;
			if (errorBody.message) {
				errorMessage = `Dokploy API error: ${errorBody.message}`;
			}
			if (errorBody.issues?.length) {
				errorMessage += `\n  Issues: ${errorBody.issues.map((i) => i.message).join(', ')}`;
			}
		} catch {
			// Ignore JSON parse errors
		}

		throw new Error(errorMessage);
	}

	return response.json() as Promise<T>;
}

/**
 * Update application environment variables
 */
async function updateEnvironment(
	baseUrl: string,
	token: string,
	applicationId: string,
	envVars: Record<string, string>,
): Promise<void> {
	logger.log('  Updating environment variables...');

	// Convert env vars to the format Dokploy expects (KEY=VALUE per line)
	const envString = Object.entries(envVars)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');

	await dokployRequest(
		'application.update',
		baseUrl,
		token,
		{
			applicationId,
			env: envString,
		},
	);

	logger.log('  ✓ Environment variables updated');
}

/**
 * Trigger application deployment
 */
async function triggerDeploy(
	baseUrl: string,
	token: string,
	applicationId: string,
): Promise<void> {
	logger.log('  Triggering deployment...');

	await dokployRequest('application.deploy', baseUrl, token, {
		applicationId,
	});

	logger.log('  ✓ Deployment triggered');
}

/**
 * Deploy to Dokploy
 */
export async function deployDokploy(
	options: DokployDeployOptions,
): Promise<DeployResult> {
	const { stage, imageRef, masterKey, config } = options;

	logger.log(`\n🎯 Deploying to Dokploy...`);
	logger.log(`   Endpoint: ${config.endpoint}`);
	logger.log(`   Application: ${config.applicationId}`);

	const token = await getApiToken();

	// Prepare environment variables
	const envVars: Record<string, string> = {};

	if (masterKey) {
		envVars.GKM_MASTER_KEY = masterKey;
	}

	// Update environment if we have variables to set
	if (Object.keys(envVars).length > 0) {
		await updateEnvironment(
			config.endpoint,
			token,
			config.applicationId,
			envVars,
		);
	}

	// Trigger deployment
	await triggerDeploy(config.endpoint, token, config.applicationId);

	logger.log('\n✅ Dokploy deployment initiated!');
	logger.log(`\n📋 Deployment details:`);
	logger.log(`   Image: ${imageRef}`);
	logger.log(`   Stage: ${stage}`);
	logger.log(`   Application ID: ${config.applicationId}`);

	if (masterKey) {
		logger.log(`\n🔐 GKM_MASTER_KEY has been set in Dokploy environment`);
	}

	// Construct the probable deployment URL
	const deploymentUrl = `${config.endpoint}/project/${config.projectId}`;
	logger.log(`\n🔗 View deployment: ${deploymentUrl}`);

	return {
		imageRef,
		masterKey,
		url: deploymentUrl,
	};
}

/**
 * Validate Dokploy configuration
 */
export function validateDokployConfig(
	config: Partial<DokployDeployConfig> | undefined,
): config is DokployDeployConfig {
	if (!config) {
		return false;
	}

	const required = ['endpoint', 'projectId', 'applicationId'] as const;
	const missing = required.filter((key) => !config[key]);

	if (missing.length > 0) {
		throw new Error(
			`Missing Dokploy configuration: ${missing.join(', ')}\n` +
				'Configure in gkm.config.ts:\n' +
				'  providers: {\n' +
				'    dokploy: {\n' +
				"      endpoint: 'https://dokploy.example.com',\n" +
				"      projectId: 'proj_xxx',\n" +
				"      applicationId: 'app_xxx',\n" +
				'    },\n' +
				'  }',
		);
	}

	return true;
}
