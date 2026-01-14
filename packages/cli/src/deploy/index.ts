import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';
import {
	getDokployCredentials,
	getDokployRegistryId,
	storeDokployCredentials,
	validateDokployToken,
} from '../auth';
import { storeDokployRegistryId } from '../auth/credentials';
import { buildCommand } from '../build/index';
import { type GkmConfig, loadConfig, loadWorkspaceConfig } from '../config';
import { getAppBuildOrder } from '../workspace/index.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { deployDocker, resolveDockerConfig } from './docker';
import { deployDokploy } from './dokploy';
import { DokployApi } from './dokploy-api';
import { updateConfig } from './init';
import type {
	AppDeployResult,
	DeployOptions,
	DeployProvider,
	DeployResult,
	DockerDeployConfig,
	DokployDeployConfig,
	WorkspaceDeployResult,
} from './types';

const logger = console;

/**
 * Prompt for input
 */
async function prompt(message: string, hidden = false): Promise<string> {
	if (!process.stdin.isTTY) {
		throw new Error('Interactive input required. Please configure manually.');
	}

	if (hidden) {
		process.stdout.write(message);
		return new Promise((resolve) => {
			let value = '';
			const onData = (char: Buffer) => {
				const c = char.toString();
				if (c === '\n' || c === '\r') {
					process.stdin.setRawMode(false);
					process.stdin.pause();
					process.stdin.removeListener('data', onData);
					process.stdout.write('\n');
					resolve(value);
				} else if (c === '\u0003') {
					process.stdin.setRawMode(false);
					process.stdin.pause();
					process.stdout.write('\n');
					process.exit(1);
				} else if (c === '\u007F' || c === '\b') {
					if (value.length > 0) value = value.slice(0, -1);
				} else {
					value += c;
				}
			};
			process.stdin.setRawMode(true);
			process.stdin.resume();
			process.stdin.on('data', onData);
		});
	}

	const rl = readline.createInterface({ input, output });
	try {
		return await rl.question(message);
	} finally {
		rl.close();
	}
}

/**
 * Docker compose services that can be provisioned
 */
interface DockerComposeServices {
	postgres?: boolean;
	redis?: boolean;
	rabbitmq?: boolean;
}

/**
 * Service URLs including both connection URLs and individual parameters
 */
interface ServiceUrls {
	DATABASE_URL?: string;
	DATABASE_HOST?: string;
	DATABASE_PORT?: string;
	DATABASE_NAME?: string;
	DATABASE_USER?: string;
	DATABASE_PASSWORD?: string;
	REDIS_URL?: string;
	REDIS_HOST?: string;
	REDIS_PORT?: string;
	REDIS_PASSWORD?: string;
}

/**
 * Result of Dokploy setup including provisioned service URLs
 */
interface DokploySetupResult {
	config: DokployDeployConfig;
	serviceUrls?: ServiceUrls;
}

/**
 * Provision docker compose services in Dokploy
 * @internal Exported for testing
 */
export async function provisionServices(
	api: DokployApi,
	projectId: string,
	environmentId: string | undefined,
	appName: string,
	services?: DockerComposeServices,
	existingUrls?: Pick<ServiceUrls, 'DATABASE_URL' | 'REDIS_URL'>,
): Promise<ServiceUrls | undefined> {
	logger.log(
		`\n🔍 provisionServices called: services=${JSON.stringify(services)}, envId=${environmentId}`,
	);
	if (!services || !environmentId) {
		logger.log('   Skipping: no services or no environmentId');
		return undefined;
	}

	const serviceUrls: ServiceUrls = {};

	if (services.postgres) {
		// Skip if DATABASE_URL already exists in secrets
		if (existingUrls?.DATABASE_URL) {
			logger.log('\n🐘 PostgreSQL: Already configured (skipping)');
		} else {
			logger.log('\n🐘 Provisioning PostgreSQL...');
			const postgresName = `${appName}-db`;

			try {
				// Generate a random password for the database
				const { randomBytes } = await import('node:crypto');
				const databasePassword = randomBytes(16).toString('hex');

				const postgres = await api.createPostgres(
					postgresName,
					projectId,
					environmentId,
					{ databasePassword },
				);
				logger.log(`   ✓ Created PostgreSQL: ${postgres.postgresId}`);

				// Deploy the database
				await api.deployPostgres(postgres.postgresId);
				logger.log('   ✓ PostgreSQL deployed');

				// Store individual connection parameters
				serviceUrls.DATABASE_HOST = postgres.appName;
				serviceUrls.DATABASE_PORT = '5432';
				serviceUrls.DATABASE_NAME = postgres.databaseName;
				serviceUrls.DATABASE_USER = postgres.databaseUser;
				serviceUrls.DATABASE_PASSWORD = postgres.databasePassword;

				// Construct connection URL using internal docker network hostname
				serviceUrls.DATABASE_URL = `postgresql://${postgres.databaseUser}:${postgres.databasePassword}@${postgres.appName}:5432/${postgres.databaseName}`;
				logger.log(`   ✓ Database credentials configured`);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				if (
					message.includes('already exists') ||
					message.includes('duplicate')
				) {
					logger.log(`   ℹ PostgreSQL already exists`);
				} else {
					logger.log(`   ⚠ Failed to provision PostgreSQL: ${message}`);
				}
			}
		}
	}

	if (services.redis) {
		// Skip if REDIS_URL already exists in secrets
		if (existingUrls?.REDIS_URL) {
			logger.log('\n🔴 Redis: Already configured (skipping)');
		} else {
			logger.log('\n🔴 Provisioning Redis...');
			const redisName = `${appName}-cache`;

			try {
				// Generate a random password for Redis
				const { randomBytes } = await import('node:crypto');
				const databasePassword = randomBytes(16).toString('hex');

				const redis = await api.createRedis(
					redisName,
					projectId,
					environmentId,
					{
						databasePassword,
					},
				);
				logger.log(`   ✓ Created Redis: ${redis.redisId}`);

				// Deploy the redis instance
				await api.deployRedis(redis.redisId);
				logger.log('   ✓ Redis deployed');

				// Store individual connection parameters
				serviceUrls.REDIS_HOST = redis.appName;
				serviceUrls.REDIS_PORT = '6379';
				if (redis.databasePassword) {
					serviceUrls.REDIS_PASSWORD = redis.databasePassword;
				}

				// Construct connection URL
				const password = redis.databasePassword
					? `:${redis.databasePassword}@`
					: '';
				serviceUrls.REDIS_URL = `redis://${password}${redis.appName}:6379`;
				logger.log(`   ✓ Redis credentials configured`);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				if (
					message.includes('already exists') ||
					message.includes('duplicate')
				) {
					logger.log(`   ℹ Redis already exists`);
				} else {
					logger.log(`   ⚠ Failed to provision Redis: ${message}`);
				}
			}
		}
	}

	return Object.keys(serviceUrls).length > 0 ? serviceUrls : undefined;
}

/**
 * Ensure Dokploy is fully configured, recovering/creating resources as needed
 */
async function ensureDokploySetup(
	config: GkmConfig,
	dockerConfig: DockerDeployConfig,
	stage: string,
	services?: DockerComposeServices,
): Promise<DokploySetupResult> {
	logger.log('\n🔧 Checking Dokploy setup...');

	// Read existing secrets to check if services are already configured
	const { readStageSecrets } = await import('../secrets/storage');
	const existingSecrets = await readStageSecrets(stage);
	const existingUrls: { DATABASE_URL?: string; REDIS_URL?: string } = {
		DATABASE_URL: existingSecrets?.urls?.DATABASE_URL,
		REDIS_URL: existingSecrets?.urls?.REDIS_URL,
	};

	// Step 1: Ensure we have Dokploy credentials
	let creds = await getDokployCredentials();

	if (!creds) {
		logger.log("\n📋 Dokploy credentials not found. Let's set them up.");
		const endpoint = await prompt(
			'Dokploy URL (e.g., https://dokploy.example.com): ',
		);
		const normalizedEndpoint = endpoint.replace(/\/$/, '');

		try {
			new URL(normalizedEndpoint);
		} catch {
			throw new Error('Invalid URL format');
		}

		logger.log(
			`\nGenerate a token at: ${normalizedEndpoint}/settings/profile\n`,
		);
		const token = await prompt('API Token: ', true);

		logger.log('\nValidating credentials...');
		const isValid = await validateDokployToken(normalizedEndpoint, token);
		if (!isValid) {
			throw new Error('Invalid credentials. Please check your token.');
		}

		await storeDokployCredentials(token, normalizedEndpoint);
		creds = { token, endpoint: normalizedEndpoint };
		logger.log('✓ Credentials saved');
	}

	const api = new DokployApi({ baseUrl: creds.endpoint, token: creds.token });

	// Step 2: Check if we have config in gkm.config.ts
	const existingConfig = config.providers?.dokploy;
	if (
		existingConfig &&
		typeof existingConfig !== 'boolean' &&
		existingConfig.applicationId &&
		existingConfig.projectId
	) {
		logger.log('✓ Dokploy config found in gkm.config.ts');

		// Verify the application still exists
		try {
			const projectDetails = await api.getProject(existingConfig.projectId);
			logger.log('✓ Project verified');

			// Get registry ID from config first, then from local storage
			const storedRegistryId =
				existingConfig.registryId ?? (await getDokployRegistryId());

			// Get environment ID for service provisioning (match by stage name)
			const environments = projectDetails.environments ?? [];
			let environment = environments.find(
				(e) => e.name.toLowerCase() === stage.toLowerCase(),
			);

			// Create environment if it doesn't exist for this stage
			if (!environment) {
				logger.log(`   Creating "${stage}" environment...`);
				environment = await api.createEnvironment(
					existingConfig.projectId,
					stage,
				);
				logger.log(`   ✓ Created environment: ${environment.environmentId}`);
			}

			const environmentId = environment.environmentId;

			// Provision services if configured
			logger.log(
				`   Services config: ${JSON.stringify(services)}, envId: ${environmentId}`,
			);
			const serviceUrls = await provisionServices(
				api,
				existingConfig.projectId,
				environmentId,
				dockerConfig.appName!,
				services,
				existingUrls,
			);

			return {
				config: {
					endpoint: existingConfig.endpoint,
					projectId: existingConfig.projectId,
					applicationId: existingConfig.applicationId,
					registry: existingConfig.registry,
					registryId: storedRegistryId ?? undefined,
				},
				serviceUrls,
			};
		} catch {
			logger.log('⚠ Project not found, will recover...');
		}
	}

	// Step 3: Find or create project
	logger.log('\n📁 Looking for project...');
	const projectName = dockerConfig.projectName!;
	const projects = await api.listProjects();
	let project = projects.find(
		(p) => p.name.toLowerCase() === projectName.toLowerCase(),
	);

	let environmentId: string;

	if (project) {
		logger.log(
			`   Found existing project: ${project.name} (${project.projectId})`,
		);

		// Step 4: Get or create environment for existing project (match by stage)
		const projectDetails = await api.getProject(project.projectId);
		const environments = projectDetails.environments ?? [];
		const matchingEnv = environments.find(
			(e) => e.name.toLowerCase() === stage.toLowerCase(),
		);
		if (matchingEnv) {
			environmentId = matchingEnv.environmentId;
			logger.log(`   Using environment: ${matchingEnv.name}`);
		} else {
			logger.log(`   Creating "${stage}" environment...`);
			const env = await api.createEnvironment(project.projectId, stage);
			environmentId = env.environmentId;
			logger.log(`   ✓ Created environment: ${stage}`);
		}
	} else {
		logger.log(`   Creating project: ${projectName}`);
		const result = await api.createProject(projectName);
		project = result.project;
		// Rename the default environment to match stage if different
		if (result.environment.name.toLowerCase() !== stage.toLowerCase()) {
			logger.log(`   Creating "${stage}" environment...`);
			const env = await api.createEnvironment(project.projectId, stage);
			environmentId = env.environmentId;
		} else {
			environmentId = result.environment.environmentId;
		}
		logger.log(`   ✓ Created project: ${project.projectId}`);
		logger.log(`   ✓ Using environment: ${stage}`);
	}

	// Step 5: Find or create application
	logger.log('\n📦 Looking for application...');
	const appName = dockerConfig.appName!;

	let applicationId: string;

	// Try to find existing app from config
	if (
		existingConfig &&
		typeof existingConfig !== 'boolean' &&
		existingConfig.applicationId
	) {
		applicationId = existingConfig.applicationId;
		logger.log(`   Using application from config: ${applicationId}`);
	} else {
		// Create new application
		logger.log(`   Creating application: ${appName}`);
		const app = await api.createApplication(
			appName,
			project.projectId,
			environmentId,
		);
		applicationId = app.applicationId;
		logger.log(`   ✓ Created application: ${applicationId}`);
	}

	// Step 6: Ensure registry is set up
	logger.log('\n🐳 Checking registry...');
	let registryId = await getDokployRegistryId();

	if (registryId) {
		// Verify stored registry still exists
		try {
			const registry = await api.getRegistry(registryId);
			logger.log(`   Using registry: ${registry.registryName}`);
		} catch {
			logger.log('   ⚠ Stored registry not found, clearing...');
			registryId = undefined;
			await storeDokployRegistryId('');
		}
	}

	if (!registryId) {
		const registries = await api.listRegistries();

		if (registries.length === 0) {
			// No registries exist
			if (dockerConfig.registry) {
				logger.log("   No registries found in Dokploy. Let's create one.");
				logger.log(`   Registry URL: ${dockerConfig.registry}`);

				const username = await prompt('Registry username: ');
				const password = await prompt('Registry password/token: ', true);

				const registry = await api.createRegistry(
					'Default Registry',
					dockerConfig.registry,
					username,
					password,
				);
				registryId = registry.registryId;
				await storeDokployRegistryId(registryId);
				logger.log(`   ✓ Registry created: ${registryId}`);
			} else {
				logger.log(
					'   ⚠ No registry configured. Set docker.registry in gkm.config.ts',
				);
			}
		} else {
			// Show available registries and let user select or create new
			logger.log('   Available registries:');
			registries.forEach((reg, i) => {
				logger.log(`     ${i + 1}. ${reg.registryName} (${reg.registryUrl})`);
			});
			if (dockerConfig.registry) {
				logger.log(`     ${registries.length + 1}. Create new registry`);
			}

			const maxOption = dockerConfig.registry
				? registries.length + 1
				: registries.length;
			const selection = await prompt(`   Select registry (1-${maxOption}): `);
			const index = parseInt(selection, 10) - 1;

			if (index >= 0 && index < registries.length) {
				// Selected existing registry
				registryId = registries[index]!.registryId;
				await storeDokployRegistryId(registryId);
				logger.log(`   ✓ Selected: ${registries[index]!.registryName}`);
			} else if (dockerConfig.registry && index === registries.length) {
				// Create new registry
				logger.log(`\n   Creating new registry...`);
				logger.log(`   Registry URL: ${dockerConfig.registry}`);

				const username = await prompt('   Registry username: ');
				const password = await prompt('   Registry password/token: ', true);

				const registry = await api.createRegistry(
					dockerConfig.registry.replace(/^https?:\/\//, ''),
					dockerConfig.registry,
					username,
					password,
				);
				registryId = registry.registryId;
				await storeDokployRegistryId(registryId);
				logger.log(`   ✓ Registry created: ${registryId}`);
			} else {
				logger.log('   ⚠ Invalid selection, skipping registry setup');
			}
		}
	}

	// Step 7: Build and save config
	const dokployConfig: DokployDeployConfig = {
		endpoint: creds.endpoint,
		projectId: project.projectId,
		applicationId,
		registryId: registryId ?? undefined,
	};

	// Update gkm.config.ts
	await updateConfig(dokployConfig);

	logger.log('\n✅ Dokploy setup complete!');
	logger.log(`   Project: ${project.projectId}`);
	logger.log(`   Application: ${applicationId}`);
	if (registryId) {
		logger.log(`   Registry: ${registryId}`);
	}

	// Step 8: Provision docker compose services if configured
	const serviceUrls = await provisionServices(
		api,
		project.projectId,
		environmentId,
		dockerConfig.appName!,
		services,
		existingUrls,
	);

	return {
		config: dokployConfig,
		serviceUrls,
	};
}

/**
 * Generate image tag from stage and timestamp
 */
export function generateTag(stage: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	return `${stage}-${timestamp}`;
}

/**
 * Deploy all apps in a workspace to Dokploy.
 * - Workspace maps to one Dokploy project
 * - Each app maps to one Dokploy application
 * - Deploys in dependency order (backends before dependent frontends)
 * - Syncs environment variables including {APP_NAME}_URL
 * @internal Exported for testing
 */
export async function workspaceDeployCommand(
	workspace: NormalizedWorkspace,
	options: DeployOptions,
): Promise<WorkspaceDeployResult> {
	const { provider, stage, tag, skipBuild, apps: selectedApps } = options;

	if (provider !== 'dokploy') {
		throw new Error(
			`Workspace deployment only supports Dokploy. Got: ${provider}`,
		);
	}

	logger.log(`\n🚀 Deploying workspace "${workspace.name}" to Dokploy...`);
	logger.log(`   Stage: ${stage}`);

	// Generate tag if not provided
	const imageTag = tag ?? generateTag(stage);
	logger.log(`   Tag: ${imageTag}`);

	// Get apps to deploy in dependency order
	const buildOrder = getAppBuildOrder(workspace);

	// Filter to selected apps if specified
	let appsToDeployNames = buildOrder;
	if (selectedApps && selectedApps.length > 0) {
		// Validate selected apps exist
		const invalidApps = selectedApps.filter((name) => !workspace.apps[name]);
		if (invalidApps.length > 0) {
			throw new Error(
				`Unknown apps: ${invalidApps.join(', ')}\n` +
					`Available apps: ${Object.keys(workspace.apps).join(', ')}`,
			);
		}
		// Keep only selected apps, but maintain dependency order
		appsToDeployNames = buildOrder.filter((name) =>
			selectedApps.includes(name),
		);
		logger.log(`   Deploying apps: ${appsToDeployNames.join(', ')}`);
	} else {
		logger.log(`   Deploying all apps: ${appsToDeployNames.join(', ')}`);
	}

	// Ensure we have Dokploy credentials
	let creds = await getDokployCredentials();
	if (!creds) {
		logger.log("\n📋 Dokploy credentials not found. Let's set them up.");
		const endpoint = await prompt(
			'Dokploy URL (e.g., https://dokploy.example.com): ',
		);
		const normalizedEndpoint = endpoint.replace(/\/$/, '');

		try {
			new URL(normalizedEndpoint);
		} catch {
			throw new Error('Invalid URL format');
		}

		logger.log(
			`\nGenerate a token at: ${normalizedEndpoint}/settings/profile\n`,
		);
		const token = await prompt('API Token: ', true);

		logger.log('\nValidating credentials...');
		const isValid = await validateDokployToken(normalizedEndpoint, token);
		if (!isValid) {
			throw new Error('Invalid credentials. Please check your token.');
		}

		await storeDokployCredentials(token, normalizedEndpoint);
		creds = { token, endpoint: normalizedEndpoint };
		logger.log('✓ Credentials saved');
	}

	const api = new DokployApi({ baseUrl: creds.endpoint, token: creds.token });

	// Find or create project for the workspace
	logger.log('\n📁 Setting up Dokploy project...');
	const projectName = workspace.name;
	const projects = await api.listProjects();
	let project = projects.find(
		(p) => p.name.toLowerCase() === projectName.toLowerCase(),
	);

	let environmentId: string;

	if (project) {
		logger.log(`   Found existing project: ${project.name}`);
		// Get or create environment for stage
		const projectDetails = await api.getProject(project.projectId);
		const environments = projectDetails.environments ?? [];
		const matchingEnv = environments.find(
			(e) => e.name.toLowerCase() === stage.toLowerCase(),
		);
		if (matchingEnv) {
			environmentId = matchingEnv.environmentId;
			logger.log(`   Using environment: ${matchingEnv.name}`);
		} else {
			logger.log(`   Creating "${stage}" environment...`);
			const env = await api.createEnvironment(project.projectId, stage);
			environmentId = env.environmentId;
			logger.log(`   ✓ Created environment: ${stage}`);
		}
	} else {
		logger.log(`   Creating project: ${projectName}`);
		const result = await api.createProject(projectName);
		project = result.project;
		// Create environment for stage if different from default
		if (result.environment.name.toLowerCase() !== stage.toLowerCase()) {
			logger.log(`   Creating "${stage}" environment...`);
			const env = await api.createEnvironment(project.projectId, stage);
			environmentId = env.environmentId;
		} else {
			environmentId = result.environment.environmentId;
		}
		logger.log(`   ✓ Created project: ${project.projectId}`);
	}

	// Get or set up registry
	logger.log('\n🐳 Checking registry...');
	let registryId = await getDokployRegistryId();
	const registry = workspace.deploy.dokploy?.registry;

	if (registryId) {
		try {
			const reg = await api.getRegistry(registryId);
			logger.log(`   Using registry: ${reg.registryName}`);
		} catch {
			logger.log('   ⚠ Stored registry not found, clearing...');
			registryId = undefined;
			await storeDokployRegistryId('');
		}
	}

	if (!registryId) {
		const registries = await api.listRegistries();
		if (registries.length > 0) {
			// Use first available registry
			registryId = registries[0]!.registryId;
			await storeDokployRegistryId(registryId);
			logger.log(`   Using registry: ${registries[0]!.registryName}`);
		} else if (registry) {
			logger.log("   No registries found in Dokploy. Let's create one.");
			logger.log(`   Registry URL: ${registry}`);

			const username = await prompt('Registry username: ');
			const password = await prompt('Registry password/token: ', true);

			const reg = await api.createRegistry(
				'Default Registry',
				registry,
				username,
				password,
			);
			registryId = reg.registryId;
			await storeDokployRegistryId(registryId);
			logger.log(`   ✓ Registry created: ${registryId}`);
		} else {
			logger.log(
				'   ⚠ No registry configured. Set deploy.dokploy.registry in workspace config',
			);
		}
	}

	// Provision infrastructure services if configured
	const services = workspace.services;
	const dockerServices = {
		postgres: services.db !== undefined && services.db !== false,
		redis: services.cache !== undefined && services.cache !== false,
	};

	if (dockerServices.postgres || dockerServices.redis) {
		logger.log('\n🔧 Provisioning infrastructure services...');
		await provisionServices(
			api,
			project.projectId,
			environmentId,
			workspace.name,
			dockerServices,
		);
	}

	// Track deployed app URLs for environment variable injection
	const deployedAppUrls: Record<string, string> = {};

	// Deploy apps in dependency order
	logger.log('\n📦 Deploying applications...');
	const results: AppDeployResult[] = [];

	for (const appName of appsToDeployNames) {
		const app = workspace.apps[appName]!;
		const appPath = app.path;

		logger.log(`\n   ${app.type === 'backend' ? '⚙️' : '🌐'} Deploying ${appName}...`);

		try {
			// Find or create application in Dokploy
			const dokployAppName = `${workspace.name}-${appName}`;
			let application;

			try {
				// Try to find existing application (Dokploy doesn't have a direct lookup)
				// We'll create a new one and handle the error if it exists
				application = await api.createApplication(
					dokployAppName,
					project.projectId,
					environmentId,
				);
				logger.log(`      Created application: ${application.applicationId}`);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				if (
					message.includes('already exists') ||
					message.includes('duplicate')
				) {
					logger.log(`      Application already exists`);
					// For now, we'll continue without the applicationId
					// In a real implementation, we'd need to list and find the app
				} else {
					throw error;
				}
			}

			// Build the app if not skipped
			if (!skipBuild) {
				logger.log(`      Building ${appName}...`);
				// For workspace, we need to build from the app directory
				const originalCwd = process.cwd();
				const fullAppPath = `${workspace.root}/${appPath}`;

				try {
					process.chdir(fullAppPath);
					await buildCommand({
						provider: 'server',
						production: true,
						stage,
					});
				} finally {
					process.chdir(originalCwd);
				}
			}

			// Build Docker image
			const imageName = `${workspace.name}-${appName}`;
			const imageRef = registry
				? `${registry}/${imageName}:${imageTag}`
				: `${imageName}:${imageTag}`;

			logger.log(`      Building Docker image: ${imageRef}`);

			await deployDocker({
				stage,
				tag: imageTag,
				skipPush: false,
				config: {
					registry,
					imageName,
				},
			});

			// Prepare environment variables
			const envVars: string[] = [
				`NODE_ENV=production`,
				`PORT=${app.port}`,
			];

			// Add dependency URLs
			for (const dep of app.dependencies) {
				const depUrl = deployedAppUrls[dep];
				if (depUrl) {
					envVars.push(`${dep.toUpperCase()}_URL=${depUrl}`);
				}
			}

			// Add infrastructure URLs for backend apps
			if (app.type === 'backend') {
				if (dockerServices.postgres) {
					envVars.push(
						`DATABASE_URL=\${DATABASE_URL:-postgresql://postgres:postgres@${workspace.name}-db:5432/app}`,
					);
				}
				if (dockerServices.redis) {
					envVars.push(
						`REDIS_URL=\${REDIS_URL:-redis://${workspace.name}-cache:6379}`,
					);
				}
			}

			// Configure application in Dokploy
			if (application) {
				// Save Docker provider config
				await api.saveDockerProvider(application.applicationId, imageRef, {
					registryId,
				});

				// Save environment variables
				await api.saveApplicationEnv(
					application.applicationId,
					envVars.join('\n'),
				);

				// Deploy
				logger.log(`      Deploying to Dokploy...`);
				await api.deployApplication(application.applicationId);

				// Track this app's URL for dependent apps
				// Dokploy uses the appName as the internal hostname
				const appUrl = `http://${dokployAppName}:${app.port}`;
				deployedAppUrls[appName] = appUrl;

				results.push({
					appName,
					type: app.type,
					success: true,
					applicationId: application.applicationId,
					imageRef,
				});

				logger.log(`      ✓ ${appName} deployed successfully`);
			} else {
				// Application already exists, just track it
				const appUrl = `http://${dokployAppName}:${app.port}`;
				deployedAppUrls[appName] = appUrl;

				results.push({
					appName,
					type: app.type,
					success: true,
					imageRef,
				});

				logger.log(`      ✓ ${appName} image pushed (app already exists)`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.log(`      ✗ Failed to deploy ${appName}: ${message}`);

			results.push({
				appName,
				type: app.type,
				success: false,
				error: message,
			});
		}
	}

	// Summary
	const successCount = results.filter((r) => r.success).length;
	const failedCount = results.filter((r) => !r.success).length;

	logger.log('\n' + '─'.repeat(50));
	logger.log(`\n✅ Workspace deployment complete!`);
	logger.log(`   Project: ${project.projectId}`);
	logger.log(`   Successful: ${successCount}`);
	if (failedCount > 0) {
		logger.log(`   Failed: ${failedCount}`);
	}

	return {
		apps: results,
		projectId: project.projectId,
		successCount,
		failedCount,
	};
}

/**
 * Main deploy command
 */
export async function deployCommand(
	options: DeployOptions,
): Promise<DeployResult | WorkspaceDeployResult> {
	const { provider, stage, tag, skipPush, skipBuild } = options;

	// Load config with workspace detection
	const loadedConfig = await loadWorkspaceConfig();

	// Route to workspace deploy mode for multi-app workspaces
	if (loadedConfig.type === 'workspace') {
		logger.log('📦 Detected workspace configuration');
		return workspaceDeployCommand(loadedConfig.workspace, options);
	}

	logger.log(`\n🚀 Deploying to ${provider}...`);
	logger.log(`   Stage: ${stage}`);

	// Single-app mode - use existing logic
	const config = await loadConfig();

	// Generate tag if not provided
	const imageTag = tag ?? generateTag(stage);
	logger.log(`   Tag: ${imageTag}`);

	// Resolve docker config for image reference
	const dockerConfig = resolveDockerConfig(config);
	const imageName = dockerConfig.imageName!;
	const registry = dockerConfig.registry;
	const imageRef = registry
		? `${registry}/${imageName}:${imageTag}`
		: `${imageName}:${imageTag}`;

	// For Dokploy, set up services BEFORE build so URLs are available
	let dokployConfig: DokployDeployConfig | undefined;
	let finalRegistry = registry;

	if (provider === 'dokploy') {
		// Extract docker compose services config
		const composeServices = config.docker?.compose?.services;
		logger.log(
			`\n🔍 Docker compose config: ${JSON.stringify(config.docker?.compose)}`,
		);
		const dockerServices: DockerComposeServices | undefined = composeServices
			? Array.isArray(composeServices)
				? {
						postgres: composeServices.includes('postgres'),
						redis: composeServices.includes('redis'),
						rabbitmq: composeServices.includes('rabbitmq'),
					}
				: {
						postgres: Boolean(composeServices.postgres),
						redis: Boolean(composeServices.redis),
						rabbitmq: Boolean(composeServices.rabbitmq),
					}
			: undefined;

		// Ensure Dokploy is fully set up (credentials, project, app, registry, services)
		const setupResult = await ensureDokploySetup(
			config,
			dockerConfig,
			stage,
			dockerServices,
		);
		dokployConfig = setupResult.config;
		finalRegistry = dokployConfig.registry ?? dockerConfig.registry;

		// Save provisioned service URLs to secrets before build
		if (setupResult.serviceUrls) {
			const { readStageSecrets, writeStageSecrets, initStageSecrets } =
				await import('../secrets/storage');
			let secrets = await readStageSecrets(stage);

			// Create secrets file if it doesn't exist
			if (!secrets) {
				logger.log(`   Creating secrets file for stage "${stage}"...`);
				secrets = initStageSecrets(stage);
			}

			let updated = false;
			// URL fields go to secrets.urls, individual params go to secrets.custom
			const urlFields = ['DATABASE_URL', 'REDIS_URL', 'RABBITMQ_URL'] as const;

			for (const [key, value] of Object.entries(setupResult.serviceUrls)) {
				if (!value) continue;

				if (urlFields.includes(key as (typeof urlFields)[number])) {
					// URL fields
					const urlKey = key as keyof typeof secrets.urls;
					if (!secrets.urls[urlKey]) {
						secrets.urls[urlKey] = value;
						logger.log(`   Saved ${key} to secrets.urls`);
						updated = true;
					}
				} else {
					// Individual parameters (HOST, PORT, NAME, USER, PASSWORD)
					if (!secrets.custom[key]) {
						secrets.custom[key] = value;
						logger.log(`   Saved ${key} to secrets.custom`);
						updated = true;
					}
				}
			}
			if (updated) {
				await writeStageSecrets(secrets);
			}
		}
	}

	// Build for production with secrets injection (unless skipped)
	let masterKey: string | undefined;
	if (!skipBuild) {
		logger.log(`\n📦 Building for production...`);
		const buildResult = await buildCommand({
			provider: 'server',
			production: true,
			stage,
		});
		masterKey = buildResult.masterKey;
	} else {
		logger.log(`\n⏭️  Skipping build (--skip-build)`);
	}

	// Deploy based on provider
	let result: DeployResult;

	switch (provider) {
		case 'docker': {
			result = await deployDocker({
				stage,
				tag: imageTag,
				skipPush,
				masterKey,
				config: dockerConfig,
			});
			break;
		}

		case 'dokploy': {
			if (!dokployConfig) {
				throw new Error('Dokploy config not initialized');
			}
			const finalImageRef = finalRegistry
				? `${finalRegistry}/${imageName}:${imageTag}`
				: `${imageName}:${imageTag}`;

			// First build and push the Docker image
			await deployDocker({
				stage,
				tag: imageTag,
				skipPush: false, // Dokploy needs the image in registry
				masterKey,
				config: {
					registry: finalRegistry,
					imageName: dockerConfig.imageName,
				},
			});

			// Then trigger Dokploy deployment
			result = await deployDokploy({
				stage,
				tag: imageTag,
				imageRef: finalImageRef,
				masterKey,
				config: dokployConfig,
			});
			break;
		}

		case 'aws-lambda': {
			logger.log('\n⚠️  AWS Lambda deployment is not yet implemented.');
			logger.log('   Use SST or AWS CDK for Lambda deployments.');
			result = { imageRef, masterKey };
			break;
		}

		default: {
			throw new Error(
				`Unknown deploy provider: ${provider}\n` +
					'Supported providers: docker, dokploy, aws-lambda',
			);
		}
	}

	logger.log('\n✅ Deployment complete!');

	return result;
}

export type { DeployOptions, DeployProvider, DeployResult };
