import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	getDokployCredentials,
	getDokployRegistryId,
	getDokployToken,
	storeDokployRegistryId,
} from '../auth';
import { DokployApi } from './dokploy-api';
import type { DokployDeployConfig } from './types';

const logger = console;

export interface DeployInitOptions {
	/** Dokploy endpoint URL (optional if logged in) */
	endpoint?: string;
	/** Project name (creates new or uses existing) */
	projectName: string;
	/** Application name */
	appName: string;
	/** Use existing project ID instead of creating/finding */
	projectId?: string;
	/** Registry ID in Dokploy (optional, uses stored if available) */
	registryId?: string;
}

export interface RegistrySetupOptions {
	/** Dokploy endpoint URL (optional if logged in) */
	endpoint?: string;
	/** Registry name (for display in Dokploy) */
	registryName: string;
	/** Registry URL (e.g., ghcr.io, docker.io) */
	registryUrl: string;
	/** Registry username */
	username: string;
	/** Registry password or token */
	password: string;
	/** Image prefix (optional, e.g., org-name) */
	imagePrefix?: string;
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
 * Get Dokploy endpoint from options or stored credentials
 */
async function getEndpoint(providedEndpoint?: string): Promise<string> {
	if (providedEndpoint) {
		return providedEndpoint;
	}

	const stored = await getDokployCredentials();
	if (stored) {
		return stored.endpoint;
	}

	throw new Error(
		'Dokploy endpoint not specified.\n' +
			'Either run "gkm login --service dokploy" first, or provide --endpoint.',
	);
}

/**
 * Create a Dokploy API client
 */
async function createApi(endpoint: string): Promise<DokployApi> {
	const token = await getApiToken();
	return new DokployApi({ baseUrl: endpoint, token });
}

/**
 * Update gkm.config.ts with Dokploy configuration
 */
export async function updateConfig(
	config: DokployDeployConfig,
	cwd: string = process.cwd(),
): Promise<void> {
	const configPath = join(cwd, 'gkm.config.ts');

	if (!existsSync(configPath)) {
		logger.warn(
			'\n  gkm.config.ts not found. Add this configuration manually:\n',
		);
		logger.log(`  providers: {`);
		logger.log(`    dokploy: {`);
		logger.log(`      endpoint: '${config.endpoint}',`);
		logger.log(`      projectId: '${config.projectId}',`);
		logger.log(`      applicationId: '${config.applicationId}',`);
		logger.log(`    },`);
		logger.log(`  },`);
		return;
	}

	const content = await readFile(configPath, 'utf-8');

	// Check if providers.dokploy already exists
	if (content.includes('dokploy:') && content.includes('applicationId:')) {
		logger.log('\n  Dokploy config already exists in gkm.config.ts');
		logger.log('  Updating with new values...');
	}

	// Build the dokploy config string
	const registryLine = config.registryId
		? `\n\t\t\tregistryId: '${config.registryId}',`
		: '';
	const dokployConfigStr = `dokploy: {
			endpoint: '${config.endpoint}',
			projectId: '${config.projectId}',
			applicationId: '${config.applicationId}',${registryLine}
		}`;

	// Try to add or update the dokploy config
	let newContent: string;

	if (content.includes('providers:')) {
		// Add dokploy to existing providers
		if (content.includes('dokploy:')) {
			// Update existing dokploy config (handle multi-line with registryId)
			newContent = content.replace(/dokploy:\s*\{[^}]*\}/s, dokployConfigStr);
		} else {
			// Add dokploy to providers
			newContent = content.replace(
				/providers:\s*\{/,
				`providers: {\n\t\t${dokployConfigStr},`,
			);
		}
	} else {
		// Add providers section before the closing of defineConfig
		newContent = content.replace(
			/}\s*\)\s*;?\s*$/,
			`
	providers: {
		${dokployConfigStr},
	},
});`,
		);
	}

	await writeFile(configPath, newContent);
	logger.log('\n  ✓ Updated gkm.config.ts with Dokploy configuration');
}

/**
 * Initialize Dokploy deployment configuration
 */
export async function deployInitCommand(
	options: DeployInitOptions,
): Promise<DokployDeployConfig> {
	const {
		projectName,
		appName,
		projectId: existingProjectId,
		registryId,
	} = options;

	const endpoint = await getEndpoint(options.endpoint);
	const api = await createApi(endpoint);

	logger.log(`\n🚀 Initializing Dokploy deployment...`);
	logger.log(`   Endpoint: ${endpoint}`);

	// Step 1: Find or create project
	let projectId: string;

	if (existingProjectId) {
		projectId = existingProjectId;
		logger.log(`\n📁 Using existing project: ${projectId}`);
	} else {
		logger.log(`\n📁 Looking for project: ${projectName}`);

		const projects = await api.listProjects();
		const existingProject = projects.find(
			(p) => p.name.toLowerCase() === projectName.toLowerCase(),
		);

		if (existingProject) {
			projectId = existingProject.projectId;
			logger.log(`   Found existing project: ${projectId}`);
		} else {
			logger.log(`   Creating new project...`);
			const result = await api.createProject(projectName);
			projectId = result.project.projectId;
			logger.log(`   ✓ Created project: ${projectId}`);
		}
	}

	// Step 2: Get project to find environment
	const project = await api.getProject(projectId);
	let environmentId: string;

	const firstEnv = project.environments?.[0];
	if (firstEnv) {
		environmentId = firstEnv.environmentId;
	} else {
		// Create a default environment
		logger.log(`   Creating production environment...`);
		const env = await api.createEnvironment(projectId, 'production');
		environmentId = env.environmentId;
	}

	// Step 3: Create application
	logger.log(`\n📦 Creating application: ${appName}`);
	const application = await api.createApplication(
		appName,
		projectId,
		environmentId,
	);
	logger.log(`   ✓ Created application: ${application.applicationId}`);

	// Step 4: Configure registry if provided
	if (registryId) {
		logger.log(`\n🔧 Configuring registry: ${registryId}`);
		await api.updateApplication(application.applicationId, { registryId });
		logger.log(`   ✓ Registry configured`);
	} else {
		// List available registries
		try {
			const registries = await api.listRegistries();
			if (registries.length > 0) {
				logger.log(`\n📋 Available registries:`);
				for (const reg of registries) {
					logger.log(
						`   - ${reg.registryName}: ${reg.registryUrl} (${reg.registryId})`,
					);
				}
				logger.log(`\n   To use a registry, run with --registry-id <id>`);
			}
		} catch {
			// Ignore registry listing errors
		}
	}

	// Step 5: Build config
	const config: DokployDeployConfig = {
		endpoint,
		projectId,
		applicationId: application.applicationId,
	};

	// Step 6: Update gkm.config.ts
	await updateConfig(config);

	logger.log(`\n✅ Dokploy deployment initialized!`);
	logger.log(`\n📋 Configuration:`);
	logger.log(`   Project ID: ${projectId}`);
	logger.log(`   Application ID: ${application.applicationId}`);
	logger.log(`\n🔗 View in Dokploy: ${endpoint}/project/${projectId}`);
	logger.log(`\n📝 Next steps:`);
	logger.log(`   1. Initialize secrets: gkm secrets:init --stage production`);
	logger.log(`   2. Deploy: gkm deploy --provider dokploy --stage production`);

	return config;
}

/**
 * List available Dokploy resources
 */
export async function deployListCommand(options: {
	endpoint?: string;
	resource: 'projects' | 'registries';
}): Promise<void> {
	const endpoint = await getEndpoint(options.endpoint);
	const api = await createApi(endpoint);

	const { resource } = options;

	if (resource === 'projects') {
		logger.log(`\n📁 Projects in ${endpoint}:`);
		const projects = await api.listProjects();

		if (projects.length === 0) {
			logger.log('   No projects found');
			return;
		}

		for (const project of projects) {
			logger.log(`\n   ${project.name} (${project.projectId})`);
			if (project.description) {
				logger.log(`     ${project.description}`);
			}
		}
	} else if (resource === 'registries') {
		logger.log(`\n🐳 Registries in ${endpoint}:`);
		const registries = await api.listRegistries();

		if (registries.length === 0) {
			logger.log('   No registries configured');
			logger.log('   Run "gkm registry:setup" to configure a registry');
			return;
		}

		const storedRegistryId = await getDokployRegistryId();

		for (const registry of registries) {
			const isDefault = registry.registryId === storedRegistryId;
			const marker = isDefault ? ' (default)' : '';
			logger.log(
				`\n   ${registry.registryName}${marker} (${registry.registryId})`,
			);
			logger.log(`     URL: ${registry.registryUrl}`);
			logger.log(`     Username: ${registry.username}`);
			if (registry.imagePrefix) {
				logger.log(`     Prefix: ${registry.imagePrefix}`);
			}
		}
	}
}

/**
 * Setup a Docker registry in Dokploy
 */
export async function registrySetupCommand(
	options: RegistrySetupOptions,
): Promise<string> {
	const { registryName, registryUrl, username, password, imagePrefix } =
		options;

	const endpoint = await getEndpoint(options.endpoint);
	const api = await createApi(endpoint);

	logger.log(`\n🐳 Setting up Docker registry in Dokploy...`);
	logger.log(`   Endpoint: ${endpoint}`);

	// Check if registry with same URL already exists
	const existingRegistries = await api.listRegistries();
	const existing = existingRegistries.find(
		(r) =>
			r.registryUrl === registryUrl ||
			r.registryName.toLowerCase() === registryName.toLowerCase(),
	);

	let registryId: string;

	if (existing) {
		logger.log(`\n📋 Found existing registry: ${existing.registryName}`);
		logger.log(`   Updating credentials...`);

		await api.updateRegistry(existing.registryId, {
			registryName,
			username,
			password,
			imagePrefix,
		});

		registryId = existing.registryId;
		logger.log(`   ✓ Registry updated: ${registryId}`);
	} else {
		logger.log(`\n📦 Creating registry: ${registryName}`);

		const registry = await api.createRegistry(
			registryName,
			registryUrl,
			username,
			password,
			{ imagePrefix },
		);

		registryId = registry.registryId;
		logger.log(`   ✓ Registry created: ${registryId}`);
	}

	// Store registry ID in credentials
	await storeDokployRegistryId(registryId);
	logger.log(`\n💾 Saved registry ID to ~/.gkm/credentials.json`);

	logger.log(`\n✅ Registry setup complete!`);
	logger.log(`\n📋 Registry Details:`);
	logger.log(`   ID: ${registryId}`);
	logger.log(`   Name: ${registryName}`);
	logger.log(`   URL: ${registryUrl}`);
	logger.log(`   Username: ${username}`);
	if (imagePrefix) {
		logger.log(`   Prefix: ${imagePrefix}`);
	}

	logger.log(
		`\n📝 The registry ID is now stored and will be used automatically`,
	);
	logger.log(`   when deploying with "gkm deploy --provider dokploy"`);

	return registryId;
}

/**
 * Use an existing registry (set as default)
 */
export async function registryUseCommand(options: {
	endpoint?: string;
	registryId: string;
}): Promise<void> {
	const { registryId } = options;

	const endpoint = await getEndpoint(options.endpoint);
	const api = await createApi(endpoint);

	logger.log(`\n🔧 Setting default registry...`);

	// Verify the registry exists
	try {
		const registry = await api.getRegistry(registryId);
		logger.log(`   Found registry: ${registry.registryName}`);
	} catch {
		throw new Error(
			`Registry not found: ${registryId}\n` +
				'Run "gkm deploy:list registries" to see available registries.',
		);
	}

	// Store registry ID in credentials
	await storeDokployRegistryId(registryId);

	logger.log(`\n✅ Default registry set: ${registryId}`);
	logger.log(`   This registry will be used for future deployments.`);
}
