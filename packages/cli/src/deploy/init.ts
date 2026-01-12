import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDokployCredentials, getDokployToken } from '../auth';
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
	/** Registry ID in Dokploy (optional) */
	registryId?: string;
}

interface DokployProject {
	projectId: string;
	name: string;
	description: string | null;
	createdAt: string;
	adminId: string;
	environments?: Array<{
		environmentId: string;
		name: string;
		description: string | null;
	}>;
}

interface DokployApplication {
	applicationId: string;
	name: string;
	appName: string;
	projectId: string;
	environmentId?: string;
}

interface DokployRegistry {
	registryId: string;
	registryName: string;
	registryUrl: string;
	username: string;
	imagePrefix: string | null;
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
	method: 'GET' | 'POST',
	endpoint: string,
	baseUrl: string,
	token: string,
	body?: Record<string, unknown>,
): Promise<T> {
	const url = `${baseUrl}/api/${endpoint}`;

	const response = await fetch(url, {
		method,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!response.ok) {
		let errorMessage = `Dokploy API error: ${response.status} ${response.statusText}`;

		try {
			const errorBody = (await response.json()) as { message?: string };
			if (errorBody.message) {
				errorMessage = `Dokploy API error: ${errorBody.message}`;
			}
		} catch {
			// Ignore JSON parse errors
		}

		throw new Error(errorMessage);
	}

	// Handle empty responses
	const text = await response.text();
	if (!text) {
		return {} as T;
	}

	return JSON.parse(text) as T;
}

/**
 * Get all projects from Dokploy
 */
async function getProjects(
	baseUrl: string,
	token: string,
): Promise<DokployProject[]> {
	return dokployRequest<DokployProject[]>('GET', 'project.all', baseUrl, token);
}

/**
 * Create a new project in Dokploy
 */
async function createProject(
	baseUrl: string,
	token: string,
	name: string,
	description?: string,
): Promise<DokployProject> {
	return dokployRequest<DokployProject>(
		'POST',
		'project.create',
		baseUrl,
		token,
		{
			name,
			description: description || `Created by gkm CLI`,
		},
	);
}

/**
 * Get project by ID to get environment info
 */
async function getProject(
	baseUrl: string,
	token: string,
	projectId: string,
): Promise<DokployProject> {
	return dokployRequest<DokployProject>('POST', 'project.one', baseUrl, token, {
		projectId,
	});
}

/**
 * Create a new application in Dokploy
 */
async function createApplication(
	baseUrl: string,
	token: string,
	name: string,
	projectId: string,
): Promise<DokployApplication> {
	// First get the project to find its environment ID
	const project = await getProject(baseUrl, token, projectId);

	// Use the first environment or create one
	let environmentId: string;

	const firstEnv = project.environments?.[0];
	if (firstEnv) {
		environmentId = firstEnv.environmentId;
	} else {
		// Create a default environment
		const env = await dokployRequest<{ environmentId: string }>(
			'POST',
			'environment.create',
			baseUrl,
			token,
			{
				projectId,
				name: 'production',
				description: 'Production environment',
			},
		);
		environmentId = env.environmentId;
	}

	return dokployRequest<DokployApplication>(
		'POST',
		'application.create',
		baseUrl,
		token,
		{
			name,
			projectId,
			environmentId,
		},
	);
}

/**
 * Configure application for Docker registry deployment
 */
async function configureApplicationRegistry(
	baseUrl: string,
	token: string,
	applicationId: string,
	registryId: string,
): Promise<void> {
	await dokployRequest('POST', 'application.update', baseUrl, token, {
		applicationId,
		registryId,
	});
}

/**
 * Get available registries
 */
async function getRegistries(
	baseUrl: string,
	token: string,
): Promise<DokployRegistry[]> {
	return dokployRequest<DokployRegistry[]>(
		'GET',
		'registry.all',
		baseUrl,
		token,
	);
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

	// Try to add or update the dokploy config
	let newContent: string;

	if (content.includes('providers:')) {
		// Add dokploy to existing providers
		if (content.includes('dokploy:')) {
			// Update existing dokploy config
			newContent = content.replace(
				/dokploy:\s*\{[^}]*\}/,
				`dokploy: {
			endpoint: '${config.endpoint}',
			projectId: '${config.projectId}',
			applicationId: '${config.applicationId}',
		}`,
			);
		} else {
			// Add dokploy to providers
			newContent = content.replace(
				/providers:\s*\{/,
				`providers: {
		dokploy: {
			endpoint: '${config.endpoint}',
			projectId: '${config.projectId}',
			applicationId: '${config.applicationId}',
		},`,
			);
		}
	} else {
		// Add providers section before the closing of defineConfig
		newContent = content.replace(
			/}\s*\)\s*;?\s*$/,
			`
	providers: {
		dokploy: {
			endpoint: '${config.endpoint}',
			projectId: '${config.projectId}',
			applicationId: '${config.applicationId}',
		},
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

	// Get endpoint from options or stored credentials
	let endpoint = options.endpoint;
	if (!endpoint) {
		const stored = await getDokployCredentials();
		if (stored) {
			endpoint = stored.endpoint;
		} else {
			throw new Error(
				'Dokploy endpoint not specified.\n' +
					'Either run "gkm login --service dokploy" first, or provide --endpoint.',
			);
		}
	}

	logger.log(`\n🚀 Initializing Dokploy deployment...`);
	logger.log(`   Endpoint: ${endpoint}`);

	const token = await getApiToken();

	// Step 1: Find or create project
	let projectId: string;

	if (existingProjectId) {
		projectId = existingProjectId;
		logger.log(`\n📁 Using existing project: ${projectId}`);
	} else {
		logger.log(`\n📁 Looking for project: ${projectName}`);

		const projects = await getProjects(endpoint, token);
		const existingProject = projects.find(
			(p) => p.name.toLowerCase() === projectName.toLowerCase(),
		);

		if (existingProject) {
			projectId = existingProject.projectId;
			logger.log(`   Found existing project: ${projectId}`);
		} else {
			logger.log(`   Creating new project...`);
			const project = await createProject(endpoint, token, projectName);
			projectId = project.projectId;
			logger.log(`   ✓ Created project: ${projectId}`);
		}
	}

	// Step 2: Create application
	logger.log(`\n📦 Creating application: ${appName}`);
	const application = await createApplication(
		endpoint,
		token,
		appName,
		projectId,
	);
	logger.log(`   ✓ Created application: ${application.applicationId}`);

	// Step 3: Configure registry if provided
	if (registryId) {
		logger.log(`\n🔧 Configuring registry: ${registryId}`);
		await configureApplicationRegistry(
			endpoint,
			token,
			application.applicationId,
			registryId,
		);
		logger.log(`   ✓ Registry configured`);
	} else {
		// List available registries
		try {
			const registries = await getRegistries(endpoint, token);
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

	// Step 4: Build config
	const config: DokployDeployConfig = {
		endpoint,
		projectId,
		applicationId: application.applicationId,
	};

	// Step 5: Update gkm.config.ts
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
	// Get endpoint from options or stored credentials
	let endpoint = options.endpoint;
	if (!endpoint) {
		const stored = await getDokployCredentials();
		if (stored) {
			endpoint = stored.endpoint;
		} else {
			throw new Error(
				'Dokploy endpoint not specified.\n' +
					'Either run "gkm login --service dokploy" first, or provide --endpoint.',
			);
		}
	}

	const { resource } = options;
	const token = await getApiToken();

	if (resource === 'projects') {
		logger.log(`\n📁 Projects in ${endpoint}:`);
		const projects = await getProjects(endpoint, token);

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
		const registries = await getRegistries(endpoint, token);

		if (registries.length === 0) {
			logger.log('   No registries configured');
			logger.log('   Add a registry in Dokploy: Settings > Docker Registry');
			return;
		}

		for (const registry of registries) {
			logger.log(`\n   ${registry.registryName} (${registry.registryId})`);
			logger.log(`     URL: ${registry.registryUrl}`);
			logger.log(`     Username: ${registry.username}`);
			if (registry.imagePrefix) {
				logger.log(`     Prefix: ${registry.imagePrefix}`);
			}
		}
	}
}
