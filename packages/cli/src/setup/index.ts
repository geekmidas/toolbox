import { existsSync } from 'node:fs';
import { join } from 'node:path';
import prompts from 'prompts';
import { loadWorkspaceConfig } from '../config.js';
import { startWorkspaceServices } from '../dev/index.js';
import { createStageSecrets } from '../secrets/generator.js';
import {
	readStageSecrets,
	secretsExist,
	writeStageSecrets,
} from '../secrets/storage.js';
import { isSSMConfigured, pullSecrets, pushSecrets } from '../secrets/sync.js';
import type { ComposeServiceName } from '../types.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
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
	let loadedConfig;
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

	// 4. Start Docker services
	if (!options.skipDocker) {
		const composeFile = join(workspace.root, 'docker-compose.yml');
		if (existsSync(composeFile)) {
			logger.log('');
			await startWorkspaceServices(workspace);
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
			return secrets;
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

	// Create base secrets with service credentials
	const secrets = createStageSecrets(stage, serviceNames);

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
