/**
 * Deploy Module
 *
 * Handles deployment of GKM workspaces to various providers (Docker, Dokploy).
 *
 * ## Per-App Database Credentials
 *
 * When deploying to Dokploy with Postgres, this module creates per-app database
 * users with isolated schemas. This follows the same pattern as local dev mode
 * (docker/postgres/init.sh).
 *
 * ### How It Works
 *
 * 1. **Provisioning**: Creates Postgres service with master credentials
 * 2. **User Creation**: For each backend app that needs DATABASE_URL:
 *    - Generates a unique password (stored in deploy state)
 *    - Creates a database user with that password
 *    - Assigns schema permissions based on app name
 * 3. **Schema Assignment**:
 *    - `api` app: Uses `public` schema (shared tables)
 *    - Other apps (e.g., `auth`): Get their own schema with `search_path` set
 * 4. **Environment Injection**: Each app receives its own DATABASE_URL
 *
 * ### Security
 *
 * - External Postgres port is enabled only during user creation, then disabled
 * - Each app can only access its own schema
 * - Credentials are stored in `.gkm/deploy-{stage}.json` (gitignored)
 * - Subsequent deploys reuse existing credentials from state
 *
 * ### Example Flow
 *
 * ```
 * gkm deploy --stage production
 *   ├─ Create Postgres (user: postgres, db: myproject)
 *   ├─ Enable external port temporarily
 *   ├─ Create user "api" → public schema
 *   ├─ Create user "auth" → auth schema (search_path=auth)
 *   ├─ Disable external port
 *   ├─ Deploy "api" with DATABASE_URL=postgresql://api:xxx@postgres:5432/myproject
 *   └─ Deploy "auth" with DATABASE_URL=postgresql://auth:yyy@postgres:5432/myproject
 * ```
 *
 * @module deploy
 */

import { randomBytes } from 'node:crypto';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';
import { Client as PgClient } from 'pg';
import {
	getDokployCredentials,
	getDokployRegistryId,
	storeDokployCredentials,
	validateDokployToken,
} from '../auth';
import { storeDokployRegistryId } from '../auth/credentials';
import { buildCommand } from '../build/index';
import { type GkmConfig, loadConfig, loadWorkspaceConfig } from '../config';
import { readStageSecrets } from '../secrets/storage.js';
import {
	getAppBuildOrder,
	getDeployTargetError,
	isDeployTargetSupported,
} from '../workspace/index.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { orchestrateDns } from './dns/index.js';
import { deployDocker, resolveDockerConfig } from './docker';
import { deployDokploy } from './dokploy';
import {
	DokployApi,
	type DokployApplication,
	type DokployPostgres,
	type DokployRedis,
} from './dokploy-api';
import {
	generatePublicUrlBuildArgs,
	getPublicUrlArgNames,
	isMainFrontendApp,
	resolveHost,
} from './domain.js';
import { updateConfig } from './init';
import { generateSecretsReport, prepareSecretsForAllApps } from './secrets.js';
import { sniffAllApps } from './sniffer.js';
import {
	type AppDbCredentials,
	createEmptyState,
	getAllAppCredentials,
	getApplicationId,
	getPostgresId,
	getRedisId,
	readStageState,
	setAppCredentials,
	setApplicationId,
	setPostgresId,
	setRedisId,
	writeStageState,
} from './state.js';
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
 * Result from provisioning services
 */
export interface ProvisionServicesResult {
	serviceUrls: ServiceUrls;
	serviceIds: {
		postgresId?: string;
		redisId?: string;
	};
}

/**
 * Configuration for a database user to create during Dokploy deployment.
 *
 * @property name - The database username (typically matches the app name)
 * @property password - The generated password for this user
 * @property usePublicSchema - If true, user gets access to public schema (for api app).
 *                             If false, user gets their own schema with search_path set.
 */
interface DbUserConfig {
	name: string;
	password: string;
	usePublicSchema: boolean;
}

/**
 * Wait for Postgres to be ready to accept connections.
 *
 * Polls the Postgres server until it accepts a connection or max retries reached.
 * Used after enabling the external port to ensure the database is accessible
 * before creating users.
 *
 * @param host - The Postgres server hostname
 * @param port - The external port (typically 5432)
 * @param user - Master database user (postgres)
 * @param password - Master database password
 * @param database - Database name to connect to
 * @param maxRetries - Maximum number of connection attempts (default: 30)
 * @param retryIntervalMs - Milliseconds between retries (default: 2000)
 * @throws Error if Postgres is not ready after maxRetries
 */
async function waitForPostgres(
	host: string,
	port: number,
	user: string,
	password: string,
	database: string,
	maxRetries = 30,
	retryIntervalMs = 2000,
): Promise<void> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			const client = new PgClient({ host, port, user, password, database });
			await client.connect();
			await client.end();
			return;
		} catch {
			if (i < maxRetries - 1) {
				logger.log(`   Waiting for Postgres... (${i + 1}/${maxRetries})`);
				await new Promise((r) => setTimeout(r, retryIntervalMs));
			}
		}
	}
	throw new Error(`Postgres not ready after ${maxRetries} retries`);
}

/**
 * Initialize Postgres with per-app users and schemas.
 *
 * This function implements the same user/schema isolation pattern used in local
 * dev mode (see docker/postgres/init.sh). It:
 *
 * 1. Temporarily enables the external Postgres port
 * 2. Connects using master credentials
 * 3. Creates each user with appropriate schema permissions
 * 4. Disables the external port for security
 *
 * Schema assignment follows this pattern:
 * - `api` app: Uses `public` schema (shared tables, migrations run here)
 * - Other apps: Get their own schema with `search_path` configured
 *
 * @param api - The Dokploy API client
 * @param postgres - The provisioned Postgres service details
 * @param serverHostname - The Dokploy server hostname (for external connection)
 * @param users - Array of users to create with their schema configuration
 *
 * @example
 * ```ts
 * await initializePostgresUsers(api, postgres, 'dokploy.example.com', [
 *   { name: 'api', password: 'xxx', usePublicSchema: true },
 *   { name: 'auth', password: 'yyy', usePublicSchema: false },
 * ]);
 * ```
 */
async function initializePostgresUsers(
	api: DokployApi,
	postgres: DokployPostgres,
	serverHostname: string,
	users: DbUserConfig[],
): Promise<void> {
	logger.log('\n🔧 Initializing database users...');

	// Enable external port temporarily
	const externalPort = 5432;
	logger.log(`   Enabling external port ${externalPort}...`);
	await api.savePostgresExternalPort(postgres.postgresId, externalPort);

	// Redeploy to apply external port change
	await api.deployPostgres(postgres.postgresId);

	// Wait for Postgres to be ready with external port
	logger.log(
		`   Waiting for Postgres to be accessible at ${serverHostname}:${externalPort}...`,
	);
	await waitForPostgres(
		serverHostname,
		externalPort,
		postgres.databaseUser,
		postgres.databasePassword,
		postgres.databaseName,
	);

	// Connect and create users
	const client = new PgClient({
		host: serverHostname,
		port: externalPort,
		user: postgres.databaseUser,
		password: postgres.databasePassword,
		database: postgres.databaseName,
	});

	try {
		await client.connect();

		for (const user of users) {
			const schemaName = user.usePublicSchema ? 'public' : user.name;
			logger.log(
				`   Creating user "${user.name}" with schema "${schemaName}"...`,
			);

			// Create or update user (handles existing users)
			await client.query(`
				DO $$ BEGIN
					CREATE USER "${user.name}" WITH PASSWORD '${user.password}';
				EXCEPTION WHEN duplicate_object THEN
					ALTER USER "${user.name}" WITH PASSWORD '${user.password}';
				END $$;
			`);

			if (user.usePublicSchema) {
				// API uses public schema
				await client.query(`
					GRANT ALL ON SCHEMA public TO "${user.name}";
					ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${user.name}";
					ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${user.name}";
				`);
			} else {
				// Other apps get their own schema
				await client.query(`
					CREATE SCHEMA IF NOT EXISTS "${schemaName}" AUTHORIZATION "${user.name}";
					ALTER USER "${user.name}" SET search_path TO "${schemaName}";
					GRANT USAGE ON SCHEMA "${schemaName}" TO "${user.name}";
					GRANT ALL ON ALL TABLES IN SCHEMA "${schemaName}" TO "${user.name}";
					ALTER DEFAULT PRIVILEGES IN SCHEMA "${schemaName}" GRANT ALL ON TABLES TO "${user.name}";
				`);
			}

			logger.log(`   ✓ User "${user.name}" configured`);
		}
	} finally {
		await client.end();
	}

	// Disable external port for security
	logger.log('   Disabling external port...');
	await api.savePostgresExternalPort(postgres.postgresId, null);
	await api.deployPostgres(postgres.postgresId);

	logger.log('   ✓ Database users initialized');
}

/**
 * Get the server hostname from the Dokploy endpoint URL
 */
function getServerHostname(endpoint: string): string {
	const url = new URL(endpoint);
	return url.hostname;
}

/**
 * Build per-app DATABASE_URL for internal Docker network communication.
 *
 * The URL uses the Postgres container name (postgresAppName) as the host,
 * which resolves via Docker's internal DNS when apps are in the same network.
 *
 * @param appName - The database username (matches the app name)
 * @param appPassword - The app's database password
 * @param postgresAppName - The Postgres container/service name in Dokploy
 * @param databaseName - The database name (typically the project name)
 * @returns A properly encoded PostgreSQL connection URL
 *
 * @example
 * ```ts
 * const url = buildPerAppDatabaseUrl('api', 'secret123', 'postgres-abc', 'myproject');
 * // Returns: postgresql://api:secret123@postgres-abc:5432/myproject
 * ```
 */
function buildPerAppDatabaseUrl(
	appName: string,
	appPassword: string,
	postgresAppName: string,
	databaseName: string,
): string {
	return `postgresql://${appName}:${encodeURIComponent(appPassword)}@${postgresAppName}:5432/${databaseName}`;
}

/**
 * Provision docker compose services in Dokploy
 * @internal Exported for testing
 */
export async function provisionServices(
	api: DokployApi,
	projectId: string,
	environmentId: string | undefined,
	projectName: string,
	services?: DockerComposeServices,
	existingServiceIds?: { postgresId?: string; redisId?: string },
): Promise<ProvisionServicesResult | undefined> {
	logger.log(
		`\n🔍 provisionServices called: services=${JSON.stringify(services)}, envId=${environmentId}`,
	);
	if (!services || !environmentId) {
		logger.log('   Skipping: no services or no environmentId');
		return undefined;
	}

	const serviceUrls: ServiceUrls = {};
	const serviceIds: { postgresId?: string; redisId?: string } = {};

	if (services.postgres) {
		logger.log('\n🐘 Checking PostgreSQL...');
		const postgresName = 'db';

		try {
			let postgres: DokployPostgres | null = null;
			let created = false;

			// Check if we have an existing ID from state
			if (existingServiceIds?.postgresId) {
				logger.log(`   Using cached ID: ${existingServiceIds.postgresId}`);
				postgres = await api.getPostgres(existingServiceIds.postgresId);
				if (postgres) {
					logger.log(`   ✓ PostgreSQL found: ${postgres.postgresId}`);
				} else {
					logger.log(`   ⚠ Cached ID invalid, will create new`);
				}
			}

			// If not found by ID, use findOrCreate
			if (!postgres) {
				const databasePassword = randomBytes(16).toString('hex');
				// Use project name as database name (replace hyphens with underscores for PostgreSQL)
				const databaseName = projectName.replace(/-/g, '_');

				const result = await api.findOrCreatePostgres(
					postgresName,
					projectId,
					environmentId,
					{ databaseName, databasePassword },
				);
				postgres = result.postgres;
				created = result.created;

				if (created) {
					logger.log(`   ✓ Created PostgreSQL: ${postgres.postgresId}`);

					// Deploy the database (only for new instances)
					await api.deployPostgres(postgres.postgresId);
					logger.log('   ✓ PostgreSQL deployed');
				} else {
					logger.log(`   ✓ PostgreSQL already exists: ${postgres.postgresId}`);
				}
			}

			// Store the ID for state
			serviceIds.postgresId = postgres.postgresId;

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
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.log(`   ⚠ Failed to provision PostgreSQL: ${message}`);
		}
	}

	if (services.redis) {
		logger.log('\n🔴 Checking Redis...');
		const redisName = 'cache';

		try {
			let redis: DokployRedis | null = null;
			let created = false;

			// Check if we have an existing ID from state
			if (existingServiceIds?.redisId) {
				logger.log(`   Using cached ID: ${existingServiceIds.redisId}`);
				redis = await api.getRedis(existingServiceIds.redisId);
				if (redis) {
					logger.log(`   ✓ Redis found: ${redis.redisId}`);
				} else {
					logger.log(`   ⚠ Cached ID invalid, will create new`);
				}
			}

			// If not found by ID, use findOrCreate
			if (!redis) {
				const { randomBytes } = await import('node:crypto');
				const databasePassword = randomBytes(16).toString('hex');

				const result = await api.findOrCreateRedis(
					redisName,
					projectId,
					environmentId,
					{ databasePassword },
				);
				redis = result.redis;
				created = result.created;

				if (created) {
					logger.log(`   ✓ Created Redis: ${redis.redisId}`);

					// Deploy the redis instance (only for new instances)
					await api.deployRedis(redis.redisId);
					logger.log('   ✓ Redis deployed');
				} else {
					logger.log(`   ✓ Redis already exists: ${redis.redisId}`);
				}
			}

			// Store the ID for state
			serviceIds.redisId = redis.redisId;

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
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.log(`   ⚠ Failed to provision Redis: ${message}`);
		}
	}

	return Object.keys(serviceUrls).length > 0
		? { serviceUrls, serviceIds }
		: undefined;
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
			// For single-app mode, we don't have state persistence yet, so pass undefined
			const provisionResult = await provisionServices(
				api,
				existingConfig.projectId,
				environmentId,
				dockerConfig.appName!,
				services,
				undefined, // No state in single-app mode
			);

			return {
				config: {
					endpoint: existingConfig.endpoint,
					projectId: existingConfig.projectId,
					applicationId: existingConfig.applicationId,
					registry: existingConfig.registry,
					registryId: storedRegistryId ?? undefined,
				},
				serviceUrls: provisionResult?.serviceUrls,
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
	// For single-app mode, we don't have state persistence yet, so pass undefined
	const provisionResult = await provisionServices(
		api,
		project.projectId,
		environmentId,
		dockerConfig.appName!,
		services,
		undefined, // No state in single-app mode
	);

	return {
		config: dokployConfig,
		serviceUrls: provisionResult?.serviceUrls,
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
 *
 * Two-phase orchestration:
 * - PHASE 1: Deploy backend apps (with encrypted secrets)
 * - PHASE 2: Deploy frontend apps (with public URLs from backends)
 *
 * Security model:
 * - Backend apps get encrypted secrets embedded at build time
 * - Only GKM_MASTER_KEY is injected as Dokploy env var
 * - Frontend apps get public URLs baked in at build time (no secrets)
 *
 * @internal Exported for testing
 */
export async function workspaceDeployCommand(
	workspace: NormalizedWorkspace,
	options: DeployOptions,
): Promise<WorkspaceDeployResult> {
	const { provider, stage, tag, apps: selectedApps } = options;

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

	// Filter apps by deploy target
	const dokployApps = appsToDeployNames.filter((name) => {
		const app = workspace.apps[name]!;
		const target = app.resolvedDeployTarget;
		if (!isDeployTargetSupported(target)) {
			logger.log(
				`   ⚠️  Skipping ${name}: ${getDeployTargetError(target, name)}`,
			);
			return false;
		}
		return true;
	});

	if (dokployApps.length === 0) {
		throw new Error(
			'No apps to deploy. All selected apps have unsupported deploy targets.',
		);
	}

	appsToDeployNames = dokployApps;

	// ==================================================================
	// PREFLIGHT: Load secrets and sniff environment requirements
	// ==================================================================
	logger.log('\n🔐 Loading secrets and analyzing environment requirements...');

	// Load secrets for this stage
	const stageSecrets = await readStageSecrets(stage, workspace.root);
	if (!stageSecrets) {
		logger.log(`   ⚠️  No secrets found for stage "${stage}"`);
		logger.log(
			`      Run "gkm secrets:init --stage ${stage}" to create secrets`,
		);
	}

	// Sniff environment variables for all apps
	const sniffedApps = await sniffAllApps(workspace.apps, workspace.root);

	// Prepare encrypted secrets for backend apps
	const encryptedSecrets = stageSecrets
		? prepareSecretsForAllApps(stageSecrets, sniffedApps)
		: new Map();

	// Report on secrets preparation
	if (stageSecrets) {
		const report = generateSecretsReport(encryptedSecrets, sniffedApps);
		if (report.appsWithSecrets.length > 0) {
			logger.log(
				`   ✓ Encrypted secrets for: ${report.appsWithSecrets.join(', ')}`,
			);
		}
		if (report.appsWithMissingSecrets.length > 0) {
			for (const { appName, missing } of report.appsWithMissingSecrets) {
				logger.log(`   ⚠️  ${appName}: Missing secrets: ${missing.join(', ')}`);
			}
		}
	}

	// ==================================================================
	// SETUP: Credentials, Project, Registry
	// ==================================================================
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
		if (result.environment.name.toLowerCase() !== stage.toLowerCase()) {
			logger.log(`   Creating "${stage}" environment...`);
			const env = await api.createEnvironment(project.projectId, stage);
			environmentId = env.environmentId;
		} else {
			environmentId = result.environment.environmentId;
		}
		logger.log(`   ✓ Created project: ${project.projectId}`);
	}

	// ==================================================================
	// STATE: Load or create deploy state for this stage
	// ==================================================================
	logger.log('\n📋 Loading deploy state...');
	let state = await readStageState(workspace.root, stage);

	if (state) {
		logger.log(`   Found existing state for stage "${stage}"`);
		// Verify environment ID matches (in case of recreation)
		if (state.environmentId !== environmentId) {
			logger.log(`   ⚠ Environment ID changed, updating state`);
			state.environmentId = environmentId;
		}
	} else {
		logger.log(`   Creating new state for stage "${stage}"`);
		state = createEmptyState(stage, environmentId);
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

	// Track provisioned postgres info for per-app DATABASE_URL
	let provisionedPostgres: DokployPostgres | null = null;
	let provisionedRedis: DokployRedis | null = null;

	if (dockerServices.postgres || dockerServices.redis) {
		logger.log('\n🔧 Provisioning infrastructure services...');
		// Pass existing service IDs from state (prefer state over URL sniffing)
		const existingServiceIds = {
			postgresId: getPostgresId(state),
			redisId: getRedisId(state),
		};

		const provisionResult = await provisionServices(
			api,
			project.projectId,
			environmentId,
			workspace.name,
			dockerServices,
			existingServiceIds,
		);

		// Update state with returned service IDs
		if (provisionResult?.serviceIds) {
			if (provisionResult.serviceIds.postgresId) {
				setPostgresId(state, provisionResult.serviceIds.postgresId);
				// Fetch full postgres info for later use
				provisionedPostgres = await api.getPostgres(
					provisionResult.serviceIds.postgresId,
				);
			}
			if (provisionResult.serviceIds.redisId) {
				setRedisId(state, provisionResult.serviceIds.redisId);
				// Fetch full redis info for later use
				provisionedRedis = await api.getRedis(
					provisionResult.serviceIds.redisId,
				);
			}
		}
	}

	// ==================================================================
	// Separate apps by type for two-phase deployment
	// ==================================================================
	const backendApps = appsToDeployNames.filter(
		(name) => workspace.apps[name]!.type === 'backend',
	);
	const frontendApps = appsToDeployNames.filter(
		(name) => workspace.apps[name]!.type === 'frontend',
	);

	// ==================================================================
	// Initialize per-app database users if Postgres is provisioned
	// ==================================================================
	const perAppDbCredentials = new Map<string, AppDbCredentials>();

	if (provisionedPostgres && backendApps.length > 0) {
		// Determine which backend apps need DATABASE_URL
		const appsNeedingDb = backendApps.filter((appName) => {
			const requirements = sniffedApps.get(appName);
			return requirements?.requiredEnvVars.includes('DATABASE_URL');
		});

		if (appsNeedingDb.length > 0) {
			logger.log(`\n🔐 Setting up per-app database credentials...`);
			logger.log(`   Apps needing DATABASE_URL: ${appsNeedingDb.join(', ')}`);

			// Get or generate credentials for each app
			const existingCredentials = getAllAppCredentials(state);
			const usersToCreate: DbUserConfig[] = [];

			for (const appName of appsNeedingDb) {
				let credentials = existingCredentials[appName];

				if (credentials) {
					logger.log(`   ${appName}: Using existing credentials from state`);
				} else {
					// Generate new credentials
					const password = randomBytes(16).toString('hex');
					credentials = { dbUser: appName, dbPassword: password };
					setAppCredentials(state, appName, credentials);
					logger.log(`   ${appName}: Generated new credentials`);
				}

				perAppDbCredentials.set(appName, credentials);

				// Always add to users to create (idempotent - will update if exists)
				usersToCreate.push({
					name: appName,
					password: credentials.dbPassword,
					usePublicSchema: appName === 'api', // API uses public schema, others get their own
				});
			}

			// Initialize database users
			const serverHostname = getServerHostname(creds.endpoint);
			await initializePostgresUsers(
				api,
				provisionedPostgres,
				serverHostname,
				usersToCreate,
			);
		}
	}

	// Track deployed app public URLs for frontend builds
	const publicUrls: Record<string, string> = {};
	const results: AppDeployResult[] = [];
	const dokployConfig = workspace.deploy.dokploy;

	// Track domain IDs and hostnames for DNS orchestration
	const appHostnames = new Map<string, string>(); // appName -> hostname
	const appDomainIds = new Map<string, string>(); // appName -> domainId

	// ==================================================================
	// PHASE 1: Deploy backend apps (with encrypted secrets)
	// ==================================================================
	if (backendApps.length > 0) {
		logger.log('\n📦 PHASE 1: Deploying backend applications...');

		for (const appName of backendApps) {
			const app = workspace.apps[appName]!;

			logger.log(`\n   ⚙️  Deploying ${appName}...`);

			try {
				// Use simple app name - project already provides namespace
				const dokployAppName = appName;

				// Check state for cached application ID
				let application: DokployApplication | null = null;
				const cachedAppId = getApplicationId(state, appName);

				if (cachedAppId) {
					logger.log(`      Using cached ID: ${cachedAppId}`);
					application = await api.getApplication(cachedAppId);
					if (application) {
						logger.log(
							`      ✓ Application found: ${application.applicationId}`,
						);
					} else {
						logger.log(`      ⚠ Cached ID invalid, will create new`);
					}
				}

				// If not found by ID, use findOrCreate
				if (!application) {
					const result = await api.findOrCreateApplication(
						dokployAppName,
						project.projectId,
						environmentId,
					);
					application = result.application;

					if (result.created) {
						logger.log(
							`      Created application: ${application.applicationId}`,
						);
					} else {
						logger.log(
							`      Found existing application: ${application.applicationId}`,
						);
					}
				}

				// Store application ID in state
				setApplicationId(state, appName, application.applicationId);

				// Get encrypted secrets for this app
				const appSecrets = encryptedSecrets.get(appName);
				const buildArgs: string[] = [];

				if (appSecrets && appSecrets.secretCount > 0) {
					buildArgs.push(
						`GKM_ENCRYPTED_CREDENTIALS=${appSecrets.payload.encrypted}`,
					);
					buildArgs.push(`GKM_CREDENTIALS_IV=${appSecrets.payload.iv}`);
					logger.log(`      Encrypted ${appSecrets.secretCount} secrets`);
				}

				// Build Docker image with encrypted secrets
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
						appName,
					},
					buildArgs,
				});

				// Prepare environment variables
				const envVars: string[] = [`NODE_ENV=production`, `PORT=${app.port}`];

				// Add master key for runtime decryption (NOT plain secrets)
				if (appSecrets?.masterKey) {
					envVars.push(`GKM_MASTER_KEY=${appSecrets.masterKey}`);
				}

				// Add per-app DATABASE_URL if this app needs it
				const appDbCreds = perAppDbCredentials.get(appName);
				if (appDbCreds && provisionedPostgres) {
					const databaseUrl = buildPerAppDatabaseUrl(
						appDbCreds.dbUser,
						appDbCreds.dbPassword,
						provisionedPostgres.appName,
						provisionedPostgres.databaseName,
					);
					envVars.push(`DATABASE_URL=${databaseUrl}`);
					logger.log(
						`      Added DATABASE_URL for user "${appDbCreds.dbUser}"`,
					);
				}

				// Add REDIS_URL if this app needs it
				const appRequirements = sniffedApps.get(appName);
				if (
					appRequirements?.requiredEnvVars.includes('REDIS_URL') &&
					provisionedRedis
				) {
					const password = provisionedRedis.databasePassword
						? `:${provisionedRedis.databasePassword}@`
						: '';
					const redisUrl = `redis://${password}${provisionedRedis.appName}:6379`;
					envVars.push(`REDIS_URL=${redisUrl}`);
					logger.log(`      Added REDIS_URL`);
				}

				// Configure and deploy application in Dokploy
				await api.saveDockerProvider(application.applicationId, imageRef, {
					registryId,
				});

				await api.saveApplicationEnv(
					application.applicationId,
					envVars.join('\n'),
				);

				logger.log(`      Deploying to Dokploy...`);
				await api.deployApplication(application.applicationId);

				// Create or find domain for this app
				const backendHost = resolveHost(
					appName,
					app,
					stage,
					dokployConfig,
					false, // Backend apps are not main frontend
				);

				// Check if domain already exists
				const existingDomains = await api.getDomainsByApplicationId(
					application.applicationId,
				);
				const existingDomain = existingDomains.find(
					(d) => d.host === backendHost,
				);

				if (existingDomain) {
					// Domain already exists
					appHostnames.set(appName, backendHost);
					appDomainIds.set(appName, existingDomain.domainId);
					publicUrls[appName] = `https://${backendHost}`;
					logger.log(`      ✓ Domain: https://${backendHost} (existing)`);
				} else {
					// Create new domain
					try {
						const domain = await api.createDomain({
							host: backendHost,
							port: app.port,
							https: true,
							certificateType: 'letsencrypt',
							applicationId: application.applicationId,
						});

						appHostnames.set(appName, backendHost);
						appDomainIds.set(appName, domain.domainId);
						publicUrls[appName] = `https://${backendHost}`;
						logger.log(`      ✓ Domain: https://${backendHost} (created)`);
					} catch (domainError) {
						const message =
							domainError instanceof Error
								? domainError.message
								: 'Unknown error';
						logger.log(`      ⚠ Domain creation failed: ${message}`);
						appHostnames.set(appName, backendHost);
						publicUrls[appName] = `https://${backendHost}`;
					}
				}

				results.push({
					appName,
					type: app.type,
					success: true,
					applicationId: application.applicationId,
					imageRef,
				});

				logger.log(`      ✓ ${appName} deployed successfully`);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				logger.log(`      ✗ Failed to deploy ${appName}: ${message}`);

				results.push({
					appName,
					type: app.type,
					success: false,
					error: message,
				});

				// Abort on backend failure to prevent incomplete deployment
				throw new Error(
					`Backend deployment failed for ${appName}. Aborting to prevent partial deployment.`,
				);
			}
		}
	}

	// ==================================================================
	// PHASE 2: Deploy frontend apps (with public URLs from backends)
	// ==================================================================
	if (frontendApps.length > 0) {
		logger.log('\n🌐 PHASE 2: Deploying frontend applications...');

		for (const appName of frontendApps) {
			const app = workspace.apps[appName]!;

			logger.log(`\n   🌐 Deploying ${appName}...`);

			try {
				// Use simple app name - project already provides namespace
				const dokployAppName = appName;

				// Check state for cached application ID
				let application: DokployApplication | null = null;
				const cachedAppId = getApplicationId(state, appName);

				if (cachedAppId) {
					logger.log(`      Using cached ID: ${cachedAppId}`);
					application = await api.getApplication(cachedAppId);
					if (application) {
						logger.log(
							`      ✓ Application found: ${application.applicationId}`,
						);
					} else {
						logger.log(`      ⚠ Cached ID invalid, will create new`);
					}
				}

				// If not found by ID, use findOrCreate
				if (!application) {
					const result = await api.findOrCreateApplication(
						dokployAppName,
						project.projectId,
						environmentId,
					);
					application = result.application;

					if (result.created) {
						logger.log(
							`      Created application: ${application.applicationId}`,
						);
					} else {
						logger.log(
							`      Found existing application: ${application.applicationId}`,
						);
					}
				}

				// Store application ID in state
				setApplicationId(state, appName, application.applicationId);

				// Generate public URL build args from dependencies
				const buildArgs = generatePublicUrlBuildArgs(app, publicUrls);
				if (buildArgs.length > 0) {
					logger.log(`      Public URLs: ${buildArgs.join(', ')}`);
				}

				// Build Docker image with public URLs
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
						appName,
					},
					buildArgs,
					// Pass public URL arg names for Dockerfile generation
					publicUrlArgs: getPublicUrlArgNames(app),
				});

				// Prepare environment variables - no secrets needed
				const envVars: string[] = [`NODE_ENV=production`, `PORT=${app.port}`];

				// Configure and deploy application in Dokploy
				await api.saveDockerProvider(application.applicationId, imageRef, {
					registryId,
				});

				await api.saveApplicationEnv(
					application.applicationId,
					envVars.join('\n'),
				);

				logger.log(`      Deploying to Dokploy...`);
				await api.deployApplication(application.applicationId);

				// Create or find domain for this app
				const isMainFrontend = isMainFrontendApp(appName, app, workspace.apps);
				const frontendHost = resolveHost(
					appName,
					app,
					stage,
					dokployConfig,
					isMainFrontend,
				);

				// Check if domain already exists
				const existingFrontendDomains = await api.getDomainsByApplicationId(
					application.applicationId,
				);
				const existingFrontendDomain = existingFrontendDomains.find(
					(d) => d.host === frontendHost,
				);

				if (existingFrontendDomain) {
					// Domain already exists
					appHostnames.set(appName, frontendHost);
					appDomainIds.set(appName, existingFrontendDomain.domainId);
					publicUrls[appName] = `https://${frontendHost}`;
					logger.log(`      ✓ Domain: https://${frontendHost} (existing)`);
				} else {
					// Create new domain
					try {
						const domain = await api.createDomain({
							host: frontendHost,
							port: app.port,
							https: true,
							certificateType: 'letsencrypt',
							applicationId: application.applicationId,
						});

						appHostnames.set(appName, frontendHost);
						appDomainIds.set(appName, domain.domainId);
						publicUrls[appName] = `https://${frontendHost}`;
						logger.log(`      ✓ Domain: https://${frontendHost} (created)`);
					} catch (domainError) {
						const message =
							domainError instanceof Error
								? domainError.message
								: 'Unknown error';
						logger.log(`      ⚠ Domain creation failed: ${message}`);
						appHostnames.set(appName, frontendHost);
						publicUrls[appName] = `https://${frontendHost}`;
					}
				}

				results.push({
					appName,
					type: app.type,
					success: true,
					applicationId: application.applicationId,
					imageRef,
				});

				logger.log(`      ✓ ${appName} deployed successfully`);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown error';
				logger.log(`      ✗ Failed to deploy ${appName}: ${message}`);

				results.push({
					appName,
					type: app.type,
					success: false,
					error: message,
				});
				// Don't abort on frontend failures - continue with other frontends
			}
		}
	}

	// ==================================================================
	// STATE: Save deploy state
	// ==================================================================
	logger.log('\n📋 Saving deploy state...');
	await writeStageState(workspace.root, stage, state);
	logger.log(`   ✓ State saved to .gkm/deploy-${stage}.json`);

	// ==================================================================
	// DNS: Create DNS records and validate domains for SSL
	// ==================================================================
	const dnsConfig = workspace.deploy.dns;
	if (dnsConfig && appHostnames.size > 0) {
		const dnsResult = await orchestrateDns(
			appHostnames,
			dnsConfig,
			creds.endpoint,
		);

		// Validate domains to trigger SSL certificate generation
		if (dnsResult?.success && appHostnames.size > 0) {
			logger.log('\n🔒 Validating domains for SSL certificates...');
			for (const [appName, hostname] of appHostnames) {
				try {
					const result = await api.validateDomain(hostname);
					if (result.isValid) {
						logger.log(`   ✓ ${appName}: ${hostname} → ${result.resolvedIp}`);
					} else {
						logger.log(`   ⚠ ${appName}: ${hostname} not valid`);
					}
				} catch (validationError) {
					const message =
						validationError instanceof Error
							? validationError.message
							: 'Unknown error';
					logger.log(`   ⚠ ${appName}: validation failed - ${message}`);
				}
			}
		}
	}

	// ==================================================================
	// Summary
	// ==================================================================
	const successCount = results.filter((r) => r.success).length;
	const failedCount = results.filter((r) => !r.success).length;

	logger.log(`\n${'─'.repeat(50)}`);
	logger.log(`\n✅ Workspace deployment complete!`);
	logger.log(`   Project: ${project.projectId}`);
	logger.log(`   Successful: ${successCount}`);
	if (failedCount > 0) {
		logger.log(`   Failed: ${failedCount}`);
	}

	// Print deployed URLs
	if (Object.keys(publicUrls).length > 0) {
		logger.log('\n   📡 Deployed URLs:');
		for (const [name, url] of Object.entries(publicUrls)) {
			logger.log(`      ${name}: ${url}`);
		}
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
