import { getDokployRegistryId, getDokployToken } from '../auth';
import { DokployApi } from './dokploy-api';
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
 * Create a Dokploy API client
 */
async function createApi(endpoint: string): Promise<DokployApi> {
	const token = await getApiToken();
	return new DokployApi({ baseUrl: endpoint, token });
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

	const api = await createApi(config.endpoint);

	// Configure Docker provider with the image
	logger.log(`  Configuring Docker image: ${imageRef}`);

	// Determine registry credentials
	const registryOptions: {
		registryId?: string;
		username?: string;
		password?: string;
		registryUrl?: string;
	} = {};

	if (config.registryId) {
		// Use registry ID from config
		registryOptions.registryId = config.registryId;
		logger.log(`  Using Dokploy registry: ${config.registryId}`);
	} else {
		// Try stored registry ID from credentials
		const storedRegistryId = await getDokployRegistryId();
		if (storedRegistryId) {
			registryOptions.registryId = storedRegistryId;
			logger.log(`  Using stored Dokploy registry: ${storedRegistryId}`);
		} else if (config.registryCredentials) {
			// Use explicit credentials from config
			registryOptions.username = config.registryCredentials.username;
			registryOptions.password = config.registryCredentials.password;
			registryOptions.registryUrl = config.registryCredentials.registryUrl;
			logger.log(`  Using registry credentials for: ${config.registryCredentials.registryUrl}`);
		} else {
			// Try environment variables
			const username = process.env.DOCKER_REGISTRY_USERNAME;
			const password = process.env.DOCKER_REGISTRY_PASSWORD;
			const registryUrl = process.env.DOCKER_REGISTRY_URL || config.registry;

			if (username && password && registryUrl) {
				registryOptions.username = username;
				registryOptions.password = password;
				registryOptions.registryUrl = registryUrl;
				logger.log(`  Using registry credentials from environment`);
			}
		}
	}

	await api.saveDockerProvider(config.applicationId, imageRef, registryOptions);
	logger.log('  ✓ Docker provider configured');

	// Prepare environment variables
	const envVars: Record<string, string> = {};

	if (masterKey) {
		envVars.GKM_MASTER_KEY = masterKey;
	}

	// Update environment if we have variables to set
	if (Object.keys(envVars).length > 0) {
		logger.log('  Updating environment variables...');

		// Convert env vars to the format Dokploy expects (KEY=VALUE per line)
		const envString = Object.entries(envVars)
			.map(([key, value]) => `${key}=${value}`)
			.join('\n');

		await api.saveApplicationEnv(config.applicationId, envString);
		logger.log('  ✓ Environment variables updated');
	}

	// Trigger deployment
	logger.log('  Triggering deployment...');
	await api.deployApplication(config.applicationId);
	logger.log('  ✓ Deployment triggered');

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
