import { existsSync } from 'node:fs';
import { join } from 'node:path';
import prompts from 'prompts';
import { loadWorkspaceConfig } from '../config.js';
import {
	resolveServicePorts,
	startWorkspaceServices,
} from '../credentials/index.js';
import {
	createStageSecrets,
	generateConnectionUrls,
	generateLocalStackCredentials,
	generateSecurePassword,
	generateServiceCredentials,
} from '../secrets/generator.js';
import {
	readStageSecrets,
	secretsExist,
	writeStageSecrets,
} from '../secrets/storage.js';
import { isSSMConfigured, pullSecrets, pushSecrets } from '../secrets/sync.js';
import type { StageSecrets } from '../secrets/types.js';
import type { ComposeServiceName } from '../types.js';
import type { LoadedConfig, NormalizedWorkspace } from '../workspace/types.js';
import {
	generateFullstackCustomSecrets,
	writeDockerEnvFromSecrets,
} from './fullstack-secrets.js';

const logger = console;

export interface SetupOptions {
	stage?: string;
	force?: boolean;
	skipDocker?: boolean;
	yes?: boolean;
}

/**
 * Setup development environment.
 *
 * Orchestrates:
 * 1. Load workspace config
 * 2. Resolve secrets (local → SSM → generate fresh)
 * 3. Write docker/.env from secrets
 * 4. Start Docker services
 */
export async function setupCommand(options: SetupOptions = {}): Promise<void> {
	const stage = options.stage ?? 'development';

	logger.log('\n🔧 Setting up development environment...\n');

	// 1. Load workspace config
	let loadedConfig: LoadedConfig;
	try {
		loadedConfig = await loadWorkspaceConfig();
	} catch {
		logger.error(
			'❌ No gkm.config.ts found. Run this command from a workspace root.',
		);
		process.exit(1);
	}

	const { workspace } = loadedConfig;
	const isMultiApp = Object.keys(workspace.apps).length > 1;

	logger.log(`📦 Workspace: ${workspace.name}`);
	logger.log(`📱 Apps: ${Object.keys(workspace.apps).join(', ')}`);
	logger.log(`🔑 Stage: ${stage}\n`);

	// 2. Resolve secrets
	const secrets = await resolveSecrets(stage, workspace, options);

	if (!secrets) {
		logger.error('❌ Failed to resolve secrets. Exiting.');
		process.exit(1);
	}

	// 3. Write docker/.env from secrets (always regenerated as derived file)
	if (isMultiApp && workspace.services.db) {
		await writeDockerEnvFromSecrets(secrets, workspace.root);
		logger.log('📄 Generated docker/.env with database passwords');
	}

	// 4. Start Docker services with resolved ports
	if (!options.skipDocker) {
		const composeFile = join(workspace.root, 'docker-compose.yml');
		if (existsSync(composeFile)) {
			logger.log('');
			const resolvedPorts = await resolveServicePorts(workspace.root);
			await startWorkspaceServices(workspace, resolvedPorts.dockerEnv);
		} else {
			logger.log('⚠️  No docker-compose.yml found. Skipping Docker services.');
		}
	}

	// Print summary
	printSummary(workspace, stage);
}

/**
 * Resolve secrets with priority:
 * 1. Local secrets exist → use them (preserves manual additions)
 * 2. SSM configured and has secrets → pull and use
 * 3. Neither → generate fresh secrets
 *
 * --force skips checks 1 and 2 and always regenerates.
 */
async function resolveSecrets(
	stage: string,
	workspace: NormalizedWorkspace,
	options: SetupOptions,
) {
	// Force regeneration
	if (options.force) {
		logger.log('🔐 Generating fresh secrets (--force)...');
		return generateFreshSecrets(stage, workspace, options);
	}

	// Check local secrets first
	if (secretsExist(stage, workspace.root)) {
		logger.log('🔐 Using existing local secrets');
		const secrets = await readStageSecrets(stage, workspace.root);
		if (secrets) {
			// Reconcile: add any missing workspace-derived keys without overwriting
			const reconciled = reconcileSecrets(secrets, workspace);
			if (reconciled) {
				await writeStageSecrets(reconciled, workspace.root);
			}
			return reconciled ?? secrets;
		}
	}

	// Try SSM pull if configured
	if (isSSMConfigured(workspace)) {
		logger.log('☁️  Checking for remote secrets in SSM...');
		try {
			const remoteSecrets = await pullSecrets(stage, workspace);
			if (remoteSecrets) {
				logger.log('✅ Pulled secrets from SSM');
				await writeStageSecrets(remoteSecrets, workspace.root);
				return remoteSecrets;
			}
			logger.log('   No remote secrets found');
		} catch (error) {
			logger.warn(`⚠️  Failed to pull from SSM: ${(error as Error).message}`);
		}
	}

	// Generate fresh secrets
	logger.log('🔐 Generating fresh development secrets...');
	return generateFreshSecrets(stage, workspace, options);
}

/**
 * Reconcile existing secrets with expected workspace-derived keys.
 * Adds missing keys (e.g. BETTER_AUTH_*) without overwriting existing values.
 * Returns the updated secrets if changes were made, or null if no changes needed.
 * @internal Exported for testing
 */
export function reconcileSecrets(
	secrets: StageSecrets,
	workspace: NormalizedWorkspace,
): StageSecrets | null {
	let changed = false;
	let result = { ...secrets };

	// Reconcile service credentials: add missing services
	const serviceMap: {
		key: keyof typeof workspace.services;
		name: ComposeServiceName;
	}[] = [
		{ key: 'db', name: 'postgres' },
		{ key: 'cache', name: 'redis' },
		{ key: 'storage', name: 'minio' },
		{ key: 'mail', name: 'mailpit' },
	];

	for (const { key, name } of serviceMap) {
		if (workspace.services[key] && !result.services[name]) {
			const creds = generateServiceCredentials(name);
			// Override defaults with project-derived names
			if (name === 'minio') {
				creds.bucket = workspace.name;
				creds.username = workspace.name;
			}
			result = {
				...result,
				services: { ...result.services, [name]: creds },
			};
			result.urls = generateConnectionUrls(
				result.services,
				result.eventsBackend,
			);
			logger.log(`   🔄 Adding missing service credentials: ${name}`);
			changed = true;
		}
	}

	// Reconcile events backend
	const eventsBackend = workspace.services.events;
	if (eventsBackend && result.eventsBackend !== eventsBackend) {
		result.eventsBackend = eventsBackend;

		// Add pgboss credentials if needed
		if (eventsBackend === 'pgboss' && !result.services.pgboss) {
			result = {
				...result,
				services: {
					...result.services,
					pgboss: {
						host: result.services.postgres?.host ?? 'localhost',
						port: result.services.postgres?.port ?? 5432,
						username: 'pgboss',
						password: generateSecurePassword(),
						database: result.services.postgres?.database ?? 'app',
					},
				},
			};
			logger.log('   🔄 Adding missing service credentials: pgboss');
			changed = true;
		}

		// Add localstack credentials if needed
		if (eventsBackend === 'sns' && !result.services.localstack) {
			result = {
				...result,
				services: {
					...result.services,
					localstack: generateLocalStackCredentials(),
				},
			};
			logger.log('   🔄 Adding missing service credentials: localstack');
			changed = true;
		}

		// Add rabbitmq credentials if needed (for rabbitmq events)
		if (eventsBackend === 'rabbitmq' && !result.services.rabbitmq) {
			result = {
				...result,
				services: {
					...result.services,
					rabbitmq: generateServiceCredentials('rabbitmq'),
				},
			};
			logger.log('   🔄 Adding missing service credentials: rabbitmq');
			changed = true;
		}

		// Regenerate URLs with new events backend
		result.urls = generateConnectionUrls(result.services, eventsBackend);
		changed = true;
	}

	// Reconcile custom secrets for multi-app workspaces
	const isMultiApp = Object.keys(workspace.apps).length > 1;
	if (isMultiApp) {
		const expected = generateFullstackCustomSecrets(workspace);
		const missing: Record<string, string> = {};

		for (const [key, value] of Object.entries(expected)) {
			if (!(key in result.custom)) {
				missing[key] = value;
			}
		}

		if (Object.keys(missing).length > 0) {
			logger.log(
				`   🔄 Adding missing secrets: ${Object.keys(missing).join(', ')}`,
			);
			result = {
				...result,
				custom: { ...result.custom, ...missing },
			};
			changed = true;
		}
	}

	if (!changed) {
		return null;
	}

	return {
		...result,
		updatedAt: new Date().toISOString(),
	};
}

/**
 * Generate fresh secrets for the workspace.
 */
async function generateFreshSecrets(
	stage: string,
	workspace: NormalizedWorkspace,
	options: SetupOptions,
) {
	// Determine services from workspace config
	const serviceNames: ComposeServiceName[] = [];
	if (workspace.services.db) serviceNames.push('postgres');
	if (workspace.services.cache) serviceNames.push('redis');
	if (workspace.services.storage) serviceNames.push('minio');
	if (workspace.services.mail) serviceNames.push('mailpit');
	if (workspace.services.events === 'sns') serviceNames.push('localstack');
	if (workspace.services.events === 'rabbitmq') serviceNames.push('rabbitmq');

	// Create base secrets with service credentials
	const secrets = createStageSecrets(stage, serviceNames, {
		projectName: workspace.name,
		eventsBackend: workspace.services.events,
	});

	// Generate fullstack-aware custom secrets
	const isMultiApp = Object.keys(workspace.apps).length > 1;
	if (isMultiApp) {
		const customSecrets = generateFullstackCustomSecrets(workspace);
		secrets.custom = customSecrets;
	} else {
		secrets.custom = {
			NODE_ENV: 'development',
			PORT: '3000',
			LOG_LEVEL: 'debug',
			JWT_SECRET: `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		};
	}

	// Write secrets
	await writeStageSecrets(secrets, workspace.root);
	logger.log(`   Secrets written to .gkm/secrets/${stage}.json`);

	// Offer to push to SSM if configured
	if (isSSMConfigured(workspace) && !options.yes) {
		const { shouldPush } = await prompts({
			type: 'confirm',
			name: 'shouldPush',
			message: 'Push secrets to SSM for team sharing?',
			initial: true,
		});

		if (shouldPush) {
			try {
				await pushSecrets(stage, workspace);
				logger.log('☁️  Secrets pushed to SSM');
			} catch (error) {
				logger.warn(`⚠️  Failed to push to SSM: ${(error as Error).message}`);
			}
		}
	}

	return secrets;
}

/**
 * Print setup summary with next steps.
 */
function printSummary(workspace: NormalizedWorkspace, stage: string): void {
	logger.log(`\n${'─'.repeat(50)}`);
	logger.log('\n✅ Development environment ready!\n');

	logger.log('📋 Apps:');
	for (const [name, app] of Object.entries(workspace.apps)) {
		const icon = app.type === 'frontend' ? '🌐' : '🔧';
		logger.log(`   ${icon} ${name} → http://localhost:${app.port}`);
	}

	logger.log('\n🚀 Next steps:');
	logger.log('   gkm dev                    # Start all apps');
	logger.log(`   gkm secrets:show --stage ${stage}  # View secrets`);
	logger.log('');
}
