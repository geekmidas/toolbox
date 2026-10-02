import { loadWorkspaceConfig } from '../config.js';
import {
	derivedContainers,
	reconcileWorkspace,
} from '../reconcile/workspace.js';
import {
	createStageSecrets,
	generateConnectionUrls,
	generateSecurePassword,
	generateServiceCredentials,
} from '../secrets/generator.js';
import { secretsStoreFor } from '../secrets/store.js';
import type { SecretServiceName, StageSecrets } from '../secrets/types.js';
import { ensureTrusted } from '../trust/index.js';
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
	logger.log('\n🔧 Setting up the local environment...\n');

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

	const stage = options.stage ?? loadedConfig.workspace.stages.local;

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
	const containers = await derivedContainers(workspace, stage);

	if (isMultiApp && containers.includes('postgres')) {
		await writeDockerEnvFromSecrets(secrets, workspace.root);
		logger.log('📄 Generated docker/.env with database passwords');
	}

	// 4. Reconcile the local target: derive containers, allocate ports, start.
	if (!options.skipDocker) {
		logger.log('');

		await reconcileLocal(workspace, stage, options);
	}

	// Print summary
	printSummary(workspace, stage);
}

/**
 * Converge this machine on what the manifest declares.
 *
 * Says what it did in one line and stays silent when it did nothing, because
 * reconciling on every start is only tolerable if the converged case is both
 * free and quiet.
 */
async function reconcileLocal(
	workspace: NormalizedWorkspace,
	stage: string,
	options: SetupOptions,
): Promise<void> {
	const result = await reconcileWorkspace(workspace, { stage });

	if (result.plan.containers.length === 0) {
		logger.log('🐳 No containers declared');
		return;
	}

	if (!result.changed) {
		logger.log('🐳 Services already up to date');
		return;
	}

	logger.log(`🐳 Services: ${result.plan.containers.join(', ')}`);
	for (const [container, address] of Object.entries(result.addresses)) {
		logger.log(`   ${container}: ${address}`);
	}

	// Only where something actually answers on https. A project with no edge has
	// no authority to trust and should never be asked about one. Every app
	// behind the edge answers there — not only a file server, which used to be
	// the only one asked about, so a workspace of APIs and sites never was.
	const url = result.plan.resources
		.filter(
			(r) =>
				r.kind === 'rest-api' || r.kind === 'site' || r.kind === 'file-server',
		)
		.map((r) => result.env[r.envKey])
		.find((address) => address?.startsWith('https://'));

	if (url) {
		await ensureTrusted(workspace.root, url, {
			...(options.yes ? { assumeYes: true } : {}),
		});
	}
}

/**
 * Resolve secrets with priority:
 * 1. Local secrets exist → use them (preserves manual additions)
 * 2. A deployed stage whose store has secrets → pull and use
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
		return generateFreshSecrets(stage, workspace);
	}

	// The stage's own store — SSM in its account, for a stage kept there
	const store = await secretsStoreFor(workspace, stage);
	const secrets = await store.read(stage);
	if (secrets) {
		logger.log('🔐 Using existing secrets');
		// Reconcile: add any missing workspace-derived keys without overwriting
		const reconciled = reconcileSecrets(
			secrets,
			workspace,
			await derivedContainers(workspace, stage),
		);
		if (reconciled) {
			await store.write(stage, reconciled);
		}
		return reconciled ?? secrets;
	}

	// Generate fresh secrets
	logger.log('🔐 Generating fresh development secrets...');
	return generateFreshSecrets(stage, workspace);
}

/**
 * Reconcile existing secrets with expected workspace-derived keys.
 * Adds missing keys (e.g. BETTER_AUTH_*) without overwriting existing values.
 * Returns the updated secrets if changes were made, or null if no changes needed.
 * @internal Exported for testing
 */
/**
 * Which containers hold a credential worth generating.
 *
 * Reconcile's container names, mapped to the service a credential is stored
 * under. `redis-http` is the Upstash-protocol proxy in front of Redis and holds
 * no credential of its own — its token is derived — so it maps to nothing, and
 * `caddy` is an edge with nothing to log into.
 */
function credentialedServices(
	containers: readonly string[],
): SecretServiceName[] {
	const byContainer: Readonly<Record<string, SecretServiceName>> = {
		postgres: 'postgres',
		redis: 'redis',
		minio: 'minio',
		mailpit: 'mailpit',
		localstack: 'localstack',
		// No `rabbitmq`: the container runs as the local user, and a topic's
		// \`rabbitmq://\` URL is reconcile's. A generated password matched
		// nothing, and the \`RABBITMQ_URL\` built from it could never connect.
	};

	return [
		...new Set(
			containers
				.map((container) => byContainer[container])
				.filter((name): name is SecretServiceName => Boolean(name)),
		),
	];
}

export function reconcileSecrets(
	secrets: StageSecrets,
	workspace: NormalizedWorkspace,
	containers: readonly string[] = [],
): StageSecrets | null {
	let changed = false;
	let result = { ...secrets };

	// Reconcile service credentials: add missing services
	for (const name of credentialedServices(containers)) {
		if (!result.services[name]) {
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
			result.urls = generateConnectionUrls(result.services);
			logger.log(`   🔄 Adding missing service credentials: ${name}`);
			changed = true;
		}
	}

	// Always add pgboss credentials when postgres is available
	if (result.services.postgres && !result.services.pgboss) {
		result = {
			...result,
			services: {
				...result.services,
				pgboss: {
					host: result.services.postgres.host,
					port: result.services.postgres.port,
					username: 'pgboss',
					password: generateSecurePassword(),
					database: result.services.postgres.database ?? 'app',
				},
			},
		};
		result.urls = generateConnectionUrls(result.services);
		logger.log('   🔄 Adding missing service credentials: pgboss');
		changed = true;
	}

	// Reconcile custom secrets for multi-app workspaces
	const isMultiApp = Object.keys(workspace.apps).length > 1;
	if (isMultiApp) {
		const expected = generateFullstackCustomSecrets(workspace, containers);
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
 * Build a fresh StageSecrets object for a workspace: service credentials,
 * connection URLs, and custom secrets. Pure — does not write to disk or touch
 * SSM. Service passwords are freshly randomized, so the result must be the same
 * one used to start the matching Docker containers.
 * @internal Exported for reuse by `gkm test` auto-setup.
 */
export function createFreshWorkspaceSecrets(
	stage: string,
	workspace: NormalizedWorkspace,
	containers: readonly string[] = [],
): StageSecrets {
	// Which services need a credential is which containers exist, and that is
	// the manifest's answer. It used to be a boolean per service read from
	// config, which generated a Postgres password for a project with no
	// database and none for a project that declared one and set no flag.
	const serviceNames = credentialedServices(containers);

	// Create base secrets with service credentials
	// No events backend: whether there are events is a declared `Topic` or
	// `Queue`, and reconcile derives their connection strings from those.
	// Passing the target's broker here would demand broker credentials from a
	// project that declared no queue at all.
	const secrets = createStageSecrets(stage, serviceNames, {
		projectName: workspace.name,
	});

	// Generate fullstack-aware custom secrets
	const isMultiApp = Object.keys(workspace.apps).length > 1;
	if (isMultiApp) {
		secrets.custom = generateFullstackCustomSecrets(workspace, containers);
	} else {
		// No `NODE_ENV`, for the reason `gkm init` gives: `gkm exec` injects
		// secrets over the environment, so a stored one made every
		// `gkm exec -- next build` a development build.
		secrets.custom = {
			PORT: '3000',
			LOG_LEVEL: 'debug',
			JWT_SECRET: `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		};
	}

	return secrets;
}

/**
 * Ensure a usable secret set exists for a stage, generating a fresh one from the
 * workspace config when none is present. No-op if secrets already exist.
 *
 * Powers `gkm test --auto-setup` / `GKM_AUTO_SETUP`: CI can run without a
 * committed secrets file or a shared encryption key — the stage is regenerated
 * from the committed `gkm.config.ts`, and the file store mints a local key.
 *
 * @returns true if fresh secrets were generated, false if existing ones were kept
 */
export async function ensureStageSecrets(
	stage: string,
	cwd: string = process.cwd(),
): Promise<boolean> {
	const { workspace } = await loadWorkspaceConfig(cwd);

	const store = await secretsStoreFor(workspace, stage);
	if (await store.read(stage)) {
		return false;
	}

	const secrets = createFreshWorkspaceSecrets(
		stage,
		workspace,
		await derivedContainers(workspace, stage),
	);
	await store.write(stage, secrets);
	return true;
}

/**
 * Generate fresh secrets for the workspace.
 */
async function generateFreshSecrets(
	stage: string,
	workspace: NormalizedWorkspace,
) {
	const secrets = createFreshWorkspaceSecrets(
		stage,
		workspace,
		await derivedContainers(workspace, stage),
	);

	// Straight to the stage's store, where a deploy from anywhere reads them.
	const store = await secretsStoreFor(workspace, stage);
	await store.write(stage, secrets);
	logger.log(`   Secrets written to the "${stage}" store (${store.name})`);

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
		const icon =
			app.type === 'web' ? '🌐' : app.type === 'mobile' ? '📱' : '🔧';
		logger.log(`   ${icon} ${name} → http://localhost:${app.port}`);
	}

	logger.log('\n🚀 Next steps:');
	logger.log('   gkm dev                    # Start all apps');
	logger.log(`   gkm secrets:show --stage ${stage}  # View secrets`);
	logger.log('');
}
