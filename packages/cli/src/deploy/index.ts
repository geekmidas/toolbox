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

import { createHash } from 'node:crypto';
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
import type { SqlClient, Statement } from '../reconcile/provision.js';
import { readStageSecrets } from '../secrets/storage.js';
import {
	getAppBuildOrder,
	getDeployTargetError,
	getPublicEnvPrefix,
	isDeployTargetSupported,
} from '../workspace/index.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { applyDeclared, provisionDeclared } from './declared';
import { orchestrateDns, verifyDnsRecords } from './dns/index.js';
import { applicationName, deployDocker, resolveDockerConfig } from './docker';
import { deployDokploy } from './dokploy';
import { DokployApi, type DokployApplication } from './dokploy-api';
import { isMainFrontendApp, resolveHost } from './domain.js';
import {
	type EnvResolverContext,
	formatMissingVarsError,
	validateEnvVars,
} from './env-resolver.js';
import type { DokployCluster } from './fromManifest';
import { createStateProvider } from './StateProvider.js';
import { generateSecretsReport, prepareSecretsForAllApps } from './secrets.js';
import { sniffAllApps } from './sniffer.js';
import {
	createEmptyState,
	getApplicationId,
	getBackupState,
	setApplicationId,
	setBackupState,
	setPostgresBackupId,
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
	/**
	 * The Dokploy environment the project's resources live in.
	 *
	 * Returned because the declared half needs it and had no way to ask: it was
	 * computed here, used here, and dropped.
	 */
	environmentId: string;
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
			// Bounded, because the interesting failure is not a refused connection
			// but a dropped one: while the container restarts around a port change,
			// the host drops the SYN rather than answering it, and an unbounded
			// connect waits out the OS timeout — a minute and a quarter — and then
			// reports ETIMEDOUT from inside a retry loop that never got to retry.
			const client = new PgClient({
				host,
				port,
				user,
				password,
				database,
				connectionTimeoutMillis: 5_000,
			});
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
 * Run the manifest's DDL against a Dokploy Postgres.
 *
 * The cluster is only reachable from outside while an external port is
 * published, so this opens one, applies, and leaves it as it found it. The
 * alternative — running DDL from inside the network — needs a container to run
 * it in, which is what `DatabaseBootstrap` is on AWS and what a Dokploy target
 * has no equivalent for yet.
 *
 * The applier is the local target's, so every statement asks whether it is
 * needed first: a redeploy is free, and a half-applied run recovers by being
 * run again.
 */
/**
 * A high port for one service, the same one every time.
 *
 * Derived from the service name rather than random so two deploys of the same
 * database agree and two different databases do not collide — and in the
 * ephemeral range, above anything a server is likely to have bound
 * deliberately.
 */
function derivedPort(appName: string): number {
	const digest = createHash('sha256').update(appName).digest();

	return 49152 + (((digest[0]! << 8) | digest[1]!) % 16000);
}

async function applyDeclaredStatements(
	api: DokployApi,
	postgres: DokployCluster,
	serverHostname: string,
	statements: readonly Statement[],
): Promise<number> {
	// Reuse whatever is already published, and otherwise pick a high port that
	// nothing on the host is likely to hold.
	//
	// 5432 was hardcoded, which fails the moment a server runs a second Postgres
	// — and this one runs fourteen. The error is `Port 5432 is already in use`,
	// from Docker rather than from anything the deploy could anticipate.
	const existing = await api
		.getPostgres(postgres.postgresId)
		.then((current) => current.externalPort)
		.catch(() => null);

	// 5432 first, then a derived port — and the order matters more than it looks.
	//
	// A high port is the tidier choice on a host running several clusters, and it
	// is also the one a firewall almost certainly drops: a VPS typically permits
	// 22, 80, 443 and whatever was opened deliberately. Publishing 55337 here
	// produced thirty polite retries against a port nothing outside could ever
	// reach, while 5432 had worked minutes earlier.
	//
	// So: the conventional port, which is the one an operator has plausibly
	// allowed, and a derived fallback only when something already holds it.
	// Already published? Use it. Re-saving the port a container already holds is
	// rejected by Docker as a conflict with *itself*, which reads like the port
	// being taken by something else.
	let externalPort = existing ?? undefined;
	const opened = externalPort === undefined;

	if (externalPort === undefined) {
		// Ask the server what it has bound rather than guessing and retrying. A
		// port free from here can be held by a service in another project, and
		// the failure names a container the caller has never heard of.
		const taken = await api.publishedPorts().catch(() => new Set<number>());

		// 5432 first when it is free: it is conventional, and therefore the port
		// an operator has plausibly allowed through the firewall. Being *free* and
		// being *reachable* are different questions and only the first has an API.
		const candidates = [5432, derivedPort(postgres.appName)].filter(
			(port) => !taken.has(port),
		);

		for (const candidate of candidates) {
			try {
				await api.savePostgresExternalPort(postgres.postgresId, candidate);
				externalPort = candidate;
				break;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!message.includes('already in use')) throw error;

				logger.log(`   Port ${candidate} is taken; trying another...`);
			}
		}

		if (externalPort === undefined) {
			throw new Error(
				`Could not publish a port for ${postgres.appName}. ` +
					`In use on this server: ${[...taken].sort((a, b) => a - b).join(', ') || 'none reported'}. ` +
					`The role DDL needs to reach the cluster from here.`,
			);
		}

		logger.log(`   Publishing ${postgres.appName} on ${externalPort}...`);
	}

	await api.deployPostgres(postgres.postgresId);
	await waitForPostgres(
		serverHostname,
		externalPort,
		postgres.databaseUser,
		postgres.databasePassword,
		postgres.databaseName,
	);

	// As the cluster master, which is the only credential that exists before any
	// role does — the same reason the AWS bootstrap connects as one.
	const client: SqlClient = {
		async query(database, sql, values) {
			const connection = new PgClient({
				host: serverHostname,
				port: externalPort,
				user: postgres.databaseUser,
				password: postgres.databasePassword,
				database: database ?? postgres.databaseName,
				connectionTimeoutMillis: 15_000,
			});

			await connection.connect();
			try {
				const result = await connection.query(sql, values as never[]);
				return result.rows;
			} finally {
				await connection.end();
			}
		},
	};

	// Whatever happens below, the database does not stay exposed. Publishing a
	// port to run DDL is a means; leaving it published is a database on the
	// public internet, which is what the path this replaces did on every deploy.
	const unpublish = async () => {
		// Only what this call opened. A port somebody published deliberately is
		// theirs, and closing it would be a deploy quietly changing how their
		// database is reached.
		if (!opened) return;

		await api
			.savePostgresExternalPort(postgres.postgresId, null)
			.then(() => api.deployPostgres(postgres.postgresId))
			.catch(() => {
				logger.log(
					`   ⚠ Could not close external port ${externalPort} on ${postgres.appName} — close it in Dokploy.`,
				);
			});
	};

	// Attempt, then wait for the cluster and attempt again.
	//
	// Publishing an external port *restarts* the container, and a TCP connect
	// succeeds against an instance that is still settling — so a pass can die
	// partway with `terminating connection due to administrator command`, or
	// with the connection dropped outright while the port rule is rewritten.
	// Retrying is safe because the applier is convergent: every statement asks
	// whether it is needed, so a later pass reapplies nothing an earlier one
	// managed. Three passes rather than two because the first restart and the
	// settling after it are separate events, and hitting both in one run is
	// ordinary rather than exceptional.
	let lastError: unknown;

	try {
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				return await applyDeclared(client, statements);
			} catch (error) {
				lastError = error;
				if (attempt === 3) break;

				const message = error instanceof Error ? error.message : String(error);
				logger.log(
					`   ⏳ Cluster still settling (${message}); retrying (${attempt}/2)...`,
				);

				await new Promise((resolve) => setTimeout(resolve, 10_000));
				await waitForPostgres(
					serverHostname,
					externalPort,
					postgres.databaseUser,
					postgres.databasePassword,
					postgres.databaseName,
				).catch(() => {});
			}
		}

		throw lastError;
	} finally {
		// Whatever happened, the database does not stay exposed. A port opened to
		// run DDL and left open is a database on the public internet — which is
		// what a failure before this point used to leave behind, and how 64614
		// came to be stuck across three attempts.
		await unpublish();
	}
}

/**
 * Get the server hostname from the Dokploy endpoint URL
 */
function getServerHostname(endpoint: string): string {
	const url = new URL(endpoint);
	return url.hostname;
}

/**
 * Ensure Dokploy is fully configured, recovering/creating resources as needed
 */
/**
 * The configured registry, among those the server already has.
 *
 * `docker.registry` is a host and optionally a namespace —
 * `ghcr.io/technanimals` — while Dokploy stores the host alone. Comparing the
 * first segment is what makes the two the same fact rather than two spellings
 * of it.
 */
function matchingRegistry(
	registries: readonly {
		registryId: string;
		registryName: string;
		registryUrl: string;
	}[],
	configured: string | undefined,
):
	| { registryId: string; registryName: string; registryUrl: string }
	| undefined {
	if (!configured) return undefined;

	const host = configured.replace(/^https?:\/\//, '').split('/')[0];

	return registries.find(
		(registry) =>
			registry.registryUrl.replace(/^https?:\/\//, '').split('/')[0] === host,
	);
}

async function ensureDokploySetup(
	config: GkmConfig,
	dockerConfig: DockerDeployConfig,
	stage: string,
	_services?: DockerComposeServices,
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

			return {
				config: {
					endpoint: existingConfig.endpoint,
					projectId: existingConfig.projectId,
					applicationId: existingConfig.applicationId,
					registry: existingConfig.registry,
					registryId: storedRegistryId ?? undefined,
				},
				environmentId,
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

	// Scoped by `resolveDockerConfig` from the gkm config's `name`, through the
	// same `scopedName` the SST target builds every physical name with.
	//
	// It used to be the cwd package.json name, unscoped — so deploying `staging`
	// into the same project matched the production application by name and
	// redeployed it.
	//
	// Still one application for two surfaces: `Api` and `Auth` are both
	// `rest-api` declarations served by one container, so neither names it. That
	// needs the manifest read before applications are created — see §6b.
	const appName = dockerConfig.appName!;

	let applicationId: string;

	// Look it up by name, then create.
	//
	// This used to reuse an application only when its id was written into
	// `gkm.config.ts`, and create one unconditionally otherwise — so a project
	// whose config could not be rewritten got a *new* application on every
	// single deploy, silently, forever. The id in a source file was never the
	// right place for it either: the server already knows what it has, and the
	// name is what identifies it.
	if (
		existingConfig &&
		typeof existingConfig !== 'boolean' &&
		existingConfig.applicationId
	) {
		applicationId = existingConfig.applicationId;
		logger.log(`   Using application from config: ${applicationId}`);
	} else {
		const { application, created } = await api.findOrCreateApplication(
			appName,
			project.projectId,
			environmentId,
		);

		applicationId = application.applicationId;
		logger.log(
			created
				? `   ✓ Created application: ${applicationId}`
				: `   ✓ Found application: ${appName} (${applicationId})`,
		);
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
		} else if (matchingRegistry(registries, dockerConfig.registry)) {
			// The config already answered this. `docker.registry` names the host
			// images are pushed to, and a registry on the server with the same
			// host is the one to use — asking which would be asking a question
			// whose answer is written down, and it is what made a deploy
			// impossible without a terminal.
			const matched = matchingRegistry(registries, dockerConfig.registry);
			if (!matched) throw new Error('unreachable');

			registryId = matched.registryId;
			await storeDokployRegistryId(registryId);
			logger.log(
				`   ✓ ${matched.registryName} (${matched.registryUrl}) — from docker.registry`,
			);
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
	// Deliberately not written back into `gkm.config.ts`.
	//
	// It used to be, with a regex that matched to the first closing brace — so a
	// nested `domains: { … }` orphaned the tail and every key it did not itself
	// write was dropped. It corrupted a config once here.
	//
	// Nothing is lost by not writing: the project, application and registry are
	// found by name on the next run, and remembered in the deploy state, which is
	// the artefact whose job that is. Generated ids in a source file were only
	// ever a cache with no invalidation.
	logger.log(`   Project ${project.projectId} · application ${applicationId}`);

	logger.log('\n✅ Dokploy setup complete!');
	logger.log(`   Project: ${project.projectId}`);
	logger.log(`   Application: ${applicationId}`);
	if (registryId) {
		logger.log(`   Registry: ${registryId}`);
	}

	return {
		config: dokployConfig,
		environmentId,
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
	// STATE: Create state provider and load deploy state
	// ==================================================================
	logger.log('\n📋 Loading deploy state...');

	// Create state provider based on workspace config
	const stateProvider = await createStateProvider({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

	let state = await stateProvider.read(stage);

	if (state) {
		logger.log(`   Found existing state for stage "${stage}"`);
		// Verify project ID matches (in case of recreation)
		if (state.projectId !== project.projectId) {
			logger.log(`   ⚠ Project ID changed, updating state`);
			state.projectId = project.projectId;
		}
		// Verify environment ID matches (in case of recreation)
		if (state.environmentId !== environmentId) {
			logger.log(`   ⚠ Environment ID changed, updating state`);
			state.environmentId = environmentId;
		}
	} else {
		logger.log(`   Creating new state for stage "${stage}"`);
		state = createEmptyState(stage, project.projectId, environmentId);
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

	// ==================================================================
	// Separate apps by type for two-phase deployment
	// ==================================================================
	// Mobile apps deploy via their own toolchain (e.g. EAS Build for Expo)
	// — skip them in the Dokploy deploy phases.
	const skippedMobileApps = appsToDeployNames.filter(
		(name) => workspace.apps[name]!.type === 'mobile',
	);
	if (skippedMobileApps.length > 0) {
		logger.log(
			`\n📱 Skipping ${skippedMobileApps.length} mobile app(s) — deploy via framework toolchain: ${skippedMobileApps.join(', ')}`,
		);
	}

	const backendApps = appsToDeployNames.filter(
		(name) => workspace.apps[name]!.type === 'backend',
	);
	const frontendApps = appsToDeployNames.filter(
		(name) => workspace.apps[name]!.type === 'web',
	);

	// ==================================================================
	// Initialize per-app database users if Postgres is provisioned
	// ==================================================================
	// Read before the declared block below, which needs it to work out where a
	// surface will answer — that has to be known before any environment is
	// saved, and it used to be decided inside the app loop, which is too late.
	const dokployConfig = workspace.deploy.dokploy;

	// ==================================================================
	// The declared half: everything the construct manifest says exists
	// ==================================================================
	// Separate from the block above on purpose. That one deploys *applications*
	// — images, registries, domains — which a project has whether or not it
	// declares anything. This is what exists because the app said so, and it is
	// skipped entirely for a project that has not adopted the model.
	//
	// It runs before any application environment is saved, because the URLs it
	// resolves are what those applications read.
	let declaredEnv: Record<string, string> = {};
	// The clusters the manifest provisioned, for anything downstream that needs
	// one — a backup schedule names a database, and that database is now
	// declared rather than configured.
	let declaredClusters: Record<string, DokployCluster> = {};

	{
		logger.log('\n📦 Provisioning declared constructs...');

		// Every surface answers on its process's address, so the address has to
		// exist before the manifest is walked. Computed here rather than in the
		// app loop, which is where it used to be decided and is too late.
		const appUrls: Record<string, string> = {};
		for (const appName of backendApps) {
			const app = workspace.apps[appName];
			if (!app) continue;

			appUrls[appName] = `https://${resolveHost(
				appName,
				app,
				stage,
				dokployConfig,
				false,
			)}`;
		}

		const declared = await provisionDeclared({
			api,
			workspace,
			projectId: project.projectId,
			environmentId: environmentId as string,
			stage,
			appUrls,
		});

		declaredEnv = declared.env;
		declaredClusters = declared.clusters;

		if (Object.keys(declaredEnv).length > 0) {
			logger.log(
				`   🔌 Resolved ${Object.keys(declaredEnv).length} declared URL(s)`,
			);
		}

		// The DDL the provisioners deferred. Roles and tables need a connection
		// to a cluster that only exists once the calls above have been made —
		// which is why they were accumulated rather than run.
		//
		// Grouped by the cluster each belongs to, and *the manifest's* cluster
		// rather than whichever Postgres happens to be around: a project may also
		// have a legacy `services.postgres`, and applying a construct's roles to
		// that one would create them where nothing connects.
		if (declared.statements.length > 0) {
			const serverHostname = getServerHostname(creds.endpoint);

			for (const [databaseName, cluster] of Object.entries(declared.clusters)) {
				const statements = declared.statements.filter(
					(statement) => statement.database === databaseName,
				);
				if (statements.length === 0) continue;

				const created = await applyDeclaredStatements(
					api,
					cluster,
					serverHostname,
					statements,
				);

				logger.log(
					`   🗄️  ${databaseName}: applied ${statements.length} statement(s), ${created} new`,
				);
			}
		}
	}

	// ==================================================================
	// Provision backup destination if configured
	// ==================================================================
	// The first declared database. A workspace that declares two and wants both
	// backed up needs a per-database schedule, which the config has no way to
	// express yet — worth saying rather than backing up one and calling it done.
	const backupCluster = Object.values(declaredClusters)[0];

	if (workspace.deploy?.backups && backupCluster) {
		logger.log('\n💾 Provisioning backup destination...');

		const { provisionBackupDestination } = await import(
			'./backup-provisioner.js'
		);

		const backupState = await provisionBackupDestination({
			api,
			projectId: project.projectId,
			projectName: workspace.name,
			stage,
			config: workspace.deploy.backups,
			existingState: getBackupState(state),
			logger,
		});

		// Save backup state
		setBackupState(state, backupState);

		// Create backup schedule for postgres if not already configured
		if (!backupState.postgresBackupId) {
			const backupSchedule = workspace.deploy.backups.schedule ?? '0 2 * * *';
			const backupRetention = workspace.deploy.backups.retention ?? 30;

			logger.log('   Creating postgres backup schedule...');
			const backup = await api.createPostgresBackup({
				schedule: backupSchedule,
				prefix: `${stage}/postgres`,
				destinationId: backupState.destinationId,
				database: backupCluster.databaseName,
				postgresId: backupCluster.postgresId,
				enabled: true,
				keepLatestCount: backupRetention,
			});
			setPostgresBackupId(state, backup.backupId);
			logger.log(`   ✓ Postgres backup schedule created (${backupSchedule})`);
		} else {
			logger.log('   ✓ Using existing postgres backup schedule');
		}
	}

	// Track deployed app public URLs for frontend builds
	const publicUrls: Record<string, string> = {};
	const results: AppDeployResult[] = [];

	// Track domain IDs and hostnames for DNS orchestration
	const appHostnames = new Map<string, string>(); // appName -> hostname
	const appDomainIds = new Map<string, string>(); // appName -> domainId

	// ==================================================================
	// PRE-COMPUTE: Frontend URLs for BETTER_AUTH_TRUSTED_ORIGINS
	// ==================================================================
	const frontendUrls: string[] = [];
	for (const appName of frontendApps) {
		const app = workspace.apps[appName]!;
		const isMainFrontend = isMainFrontendApp(appName, app, workspace.apps);
		const hostname = resolveHost(
			appName,
			app,
			stage,
			dokployConfig,
			isMainFrontend,
		);
		frontendUrls.push(`https://${hostname}`);
	}

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
				// Scoped exactly as a construct is, and by the same function. It
				// used to be the bare app key, so a project held an `api` and a
				// `web` that every stage would collide on.
				const dokployAppName = applicationName(stage, workspace.name, appName);

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

				// Compute hostname first (needed for BETTER_AUTH_URL)
				const backendHost = resolveHost(
					appName,
					app,
					stage,
					dokployConfig,
					false, // Backend apps are not main frontend
				);

				// Build dependency URLs from already-deployed apps
				const dependencyUrls: Record<string, string> = {};
				if (app.dependencies) {
					for (const dep of app.dependencies) {
						if (publicUrls[dep]) {
							dependencyUrls[dep] = publicUrls[dep];
						}
					}
				}

				// Build env resolver context
				const envContext: EnvResolverContext = {
					app,
					appName,
					stage,
					state,
					appHostname: backendHost,
					frontendUrls,
					userSecrets: stageSecrets ?? undefined,
					masterKey: appSecrets?.masterKey,
					dependencyUrls,
				};

				// Resolve all required environment variables
				// Always include PORT, NODE_ENV, STAGE even if not explicitly required
				const appRequirements = sniffedApps.get(appName);
				const sniffedVars = appRequirements?.requiredEnvVars ?? [];
				const requiredVars = [
					...new Set(['PORT', 'NODE_ENV', 'STAGE', ...sniffedVars]),
				];
				const { valid, missing, resolved } = validateEnvVars(
					requiredVars,
					envContext,
				);

				if (!valid) {
					throw new Error(formatMissingVarsError(appName, missing, stage));
				}

				// Declared URLs win over anything sniffed or stored, which is the
				// same precedence the local target applies: the manifest is the
				// statement of what exists, and a value left over from before it
				// was declared is exactly the drift this replaces.
				//
				// They are merged *after* validation rather than added to the
				// required list, because the sniffer cannot see them — a construct
				// reads its own key inside `@geekmidas/constructs`, so requiring
				// them would fail every app that declares anything.
				const withDeclared = { ...resolved, ...declaredEnv };

				// Build env vars string for Dokploy
				const envVars: string[] = Object.entries(withDeclared).map(
					([key, value]) => `${key}=${value}`,
				);

				if (Object.keys(withDeclared).length > 0) {
					logger.log(
						`      Resolved ${Object.keys(withDeclared).length} env vars: ${Object.keys(withDeclared).sort().join(', ')}`,
					);
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

				// Check if domain already exists (backendHost computed above)
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
				// Scoped exactly as a construct is, and by the same function. It
				// used to be the bare app key, so a project held an `api` and a
				// `web` that every stage would collide on.
				const dokployAppName = applicationName(stage, workspace.name, appName);

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

				// Build dependency URLs for frontend (same pattern as backend)
				const dependencyUrls: Record<string, string> = {};
				if (app.dependencies) {
					for (const dep of app.dependencies) {
						if (publicUrls[dep]) {
							dependencyUrls[dep] = publicUrls[dep];
						}
					}
				}

				// Compute hostname for this frontend app
				const isMainFrontend = isMainFrontendApp(appName, app, workspace.apps);
				const frontendHost = resolveHost(
					appName,
					app,
					stage,
					dokployConfig,
					isMainFrontend,
				);

				// Build env context for frontend
				const envContext: EnvResolverContext = {
					app,
					appName,
					stage,
					state,
					appHostname: frontendHost,
					frontendUrls: [],
					userSecrets: stageSecrets ?? undefined,
					dependencyUrls,
				};

				// Resolve all env vars BEFORE Docker build (public-prefixed vars
				// must be present at bundler build time so they get inlined).
				const sniffedVars = sniffedApps.get(appName)?.requiredEnvVars ?? [];
				const { valid, missing, resolved } = validateEnvVars(
					sniffedVars,
					envContext,
				);

				if (!valid) {
					throw new Error(formatMissingVarsError(appName, missing, stage));
				}

				if (Object.keys(resolved).length > 0) {
					logger.log(
						`      Resolved ${Object.keys(resolved).length} env vars: ${Object.keys(resolved).join(', ')}`,
					);
				}

				// Build args: only the framework's public-prefixed vars get baked
				// into the bundle. Server-only vars stay as runtime env.
				const publicPrefix = getPublicEnvPrefix(app.framework);
				const buildArgs: string[] = [];
				const publicUrlArgNames: string[] = [];

				if (publicPrefix) {
					for (const [key, value] of Object.entries(resolved)) {
						if (key.startsWith(publicPrefix)) {
							buildArgs.push(`${key}=${value}`);
							publicUrlArgNames.push(key);
						}
					}
				}

				if (buildArgs.length > 0) {
					logger.log(`      Build args: ${publicUrlArgNames.join(', ')}`);
				}

				// Build Docker image with public-prefixed vars as build args
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
					// Pass arg names for Dockerfile ARG generation
					publicUrlArgs: publicUrlArgNames,
				});

				// Prepare runtime environment variables
				const envVars: string[] = [
					`NODE_ENV=production`,
					`PORT=${app.port}`,
					`STAGE=${stage}`,
				];

				// Add all resolved vars as runtime env (for SSR and server components)
				for (const [key, value] of Object.entries(resolved)) {
					envVars.push(`${key}=${value}`);
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

				// Check if domain already exists (frontendHost computed earlier for env context)
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
	await stateProvider.write(stage, state);
	logger.log('   ✓ State saved');

	// ==================================================================
	// DNS: Create DNS records, verify propagation, and validate for SSL
	// ==================================================================
	const dnsConfig = workspace.deploy.dns;
	if (dnsConfig && appHostnames.size > 0) {
		const dnsResult = await orchestrateDns(
			appHostnames,
			dnsConfig,
			creds.endpoint,
		);

		// Verify DNS records resolve correctly (with state caching)
		if (dnsResult?.serverIp && appHostnames.size > 0) {
			await verifyDnsRecords(appHostnames, dnsResult.serverIp, state);

			// Save state again to persist DNS verification results
			await stateProvider.write(stage, state);
		}

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
	const dockerConfig = resolveDockerConfig(config, stage);
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

		// The declared half, before the build — which is the whole reason this
		// block runs where it does. `bundleServer` validates that every key the
		// app reads exists, and a construct's key exists only once something has
		// resolved it. Provisioning after the build would fail on exactly the
		// URLs provisioning is there to supply.
		{
			const { workspace } = await loadWorkspaceConfig();

			{
				logger.log('\n📦 Provisioning declared constructs...');

				// The domain comes from the workspace's own deploy config, which a
				// single-app project can now carry. `DokployDeployConfig` is the
				// per-app half — endpoint, project, application — and has never
				// held domains.
				const workspaceDokploy = workspace.deploy.dokploy;
				const appUrls: Record<string, string> = {};

				if (workspaceDokploy?.domains?.[stage]) {
					appUrls.api = `https://${resolveHost(
						'api',
						workspace.apps.api as never,
						stage,
						workspaceDokploy,
						false,
					)}`;
				}

				const creds = await getDokployCredentials();
				const api = new DokployApi({
					baseUrl: creds?.endpoint ?? dokployConfig.endpoint,
					token: creds?.token ?? '',
				});

				const declared = await provisionDeclared({
					api,
					workspace,
					projectId: dokployConfig.projectId,
					environmentId: setupResult.environmentId,
					stage,
					appUrls,
				});

				if (Object.keys(declared.env).length > 0) {
					logger.log(
						`   🔌 Resolved ${Object.keys(declared.env).length} declared URL(s)`,
					);

					const { readStageSecrets, writeStageSecrets, initStageSecrets } =
						await import('../secrets/storage');
					const secrets =
						(await readStageSecrets(stage)) ?? initStageSecrets(stage);

					// Declared URLs win: the manifest is the statement of what
					// exists, and a value left from before it was declared is the
					// drift this replaces.
					secrets.custom = { ...secrets.custom, ...declared.env };
					await writeStageSecrets(secrets);
				}

				if (declared.statements.length > 0) {
					const serverHostname = getServerHostname(
						creds?.endpoint ?? dokployConfig.endpoint,
					);

					for (const [databaseName, cluster] of Object.entries(
						declared.clusters,
					)) {
						const statements = declared.statements.filter(
							(statement) => statement.database === databaseName,
						);
						if (statements.length === 0) continue;

						const created = await applyDeclaredStatements(
							api,
							cluster,
							serverHostname,
							statements,
						);
						logger.log(
							`   🗄️  ${databaseName}: applied ${statements.length} statement(s), ${created} new`,
						);
					}
				}
			}
		}

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
