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
import { loadConfig, type GkmConfig } from '../config';
import { deployDocker, resolveDockerConfig } from './docker';
import { DokployApi } from './dokploy-api';
import { deployDokploy, validateDokployConfig } from './dokploy';
import { updateConfig } from './init';
import type {
	DeployOptions,
	DeployProvider,
	DeployResult,
	DokployDeployConfig,
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
 * Ensure Dokploy is fully configured, recovering/creating resources as needed
 */
async function ensureDokploySetup(
	config: GkmConfig,
	dockerConfig: { registry?: string; imageName?: string },
): Promise<DokployDeployConfig> {
	logger.log('\n🔧 Checking Dokploy setup...');

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
			await api.getProject(existingConfig.projectId);
			logger.log('✓ Project verified');

			// Get stored registry ID
			const storedRegistryId = await getDokployRegistryId();

			return {
				endpoint: existingConfig.endpoint,
				projectId: existingConfig.projectId,
				applicationId: existingConfig.applicationId,
				registry: existingConfig.registry,
				registryId: storedRegistryId ?? undefined,
			};
		} catch {
			logger.log('⚠ Project not found, will recover...');
		}
	}

	// Step 3: Find or create project
	logger.log('\n📁 Looking for project...');
	const projectName = dockerConfig.imageName || 'app';
	const projects = await api.listProjects();
	let project = projects.find(
		(p) => p.name.toLowerCase() === projectName.toLowerCase(),
	);

	if (project) {
		logger.log(
			`   Found existing project: ${project.name} (${project.projectId})`,
		);
	} else {
		logger.log(`   Creating project: ${projectName}`);
		project = await api.createProject(projectName);
		logger.log(`   ✓ Created project: ${project.projectId}`);
	}

	// Step 4: Get or create environment
	const projectDetails = await api.getProject(project.projectId);
	let environmentId: string;

	const environments = projectDetails.environments ?? [];
	const firstEnv = environments[0];
	if (firstEnv) {
		environmentId = firstEnv.environmentId;
		logger.log(`   Using environment: ${firstEnv.name}`);
	} else {
		logger.log('   Creating production environment...');
		const env = await api.createEnvironment(project.projectId, 'production');
		environmentId = env.environmentId;
	}

	// Step 5: Find or create application
	logger.log('\n📦 Looking for application...');
	const appName = dockerConfig.imageName || projectName;

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
		const app = await api.createApplication(appName, project.projectId, environmentId);
		applicationId = app.applicationId;
		logger.log(`   ✓ Created application: ${applicationId}`);
	}

	// Step 6: Ensure registry is set up
	logger.log('\n🐳 Checking registry...');
	let registryId = await getDokployRegistryId();

	if (!registryId) {
		const registries = await api.listRegistries();
		const firstRegistry = registries[0];

		if (firstRegistry) {
			// Use first available registry
			registryId = firstRegistry.registryId;
			await storeDokployRegistryId(registryId);
			logger.log(`   Using existing registry: ${firstRegistry.registryName}`);
		} else if (dockerConfig.registry) {
			// Need to create a registry
			logger.log('   No registry found. Let\'s set one up.');
			logger.log(`   Registry URL will be: ${dockerConfig.registry}`);

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
		logger.log(`   Using stored registry: ${registryId}`);
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

	return dokployConfig;
}

/**
 * Generate image tag from stage and timestamp
 */
export function generateTag(stage: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	return `${stage}-${timestamp}`;
}

/**
 * Main deploy command
 */
export async function deployCommand(
	options: DeployOptions,
): Promise<DeployResult> {
	const { provider, stage, tag, skipPush, skipBuild } = options;

	logger.log(`\n🚀 Deploying to ${provider}...`);
	logger.log(`   Stage: ${stage}`);

	// Load config
	const config = await loadConfig();

	// Generate tag if not provided
	const imageTag = tag ?? generateTag(stage);
	logger.log(`   Tag: ${imageTag}`);

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

	// Resolve docker config for image reference
	const dockerConfig = resolveDockerConfig(config);
	const imageName = dockerConfig.imageName ?? 'app';
	const registry = dockerConfig.registry;
	const imageRef = registry
		? `${registry}/${imageName}:${imageTag}`
		: `${imageName}:${imageTag}`;

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
			// Ensure Dokploy is fully set up (credentials, project, app, registry)
			const dokployConfig = await ensureDokploySetup(config, dockerConfig);

			// Update imageRef with correct registry
			const finalRegistry = dokployConfig.registry ?? dockerConfig.registry;
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
