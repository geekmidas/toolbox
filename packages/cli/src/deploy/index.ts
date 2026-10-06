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
import type { ConstructManifest } from '@geekmidas/manifest';
import { Client as PgClient } from 'pg';
import {
	getDokployCredentials,
	storeDokployCredentials,
	validateDokployToken,
} from '../auth';
import { loadWorkspaceConfig } from '../config';
import { discover } from '../reconcile/discover.js';
import type { SqlClient, Statement } from '../reconcile/provision.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { initStageSecrets } from '../secrets/storage.js';
import { secretsStoreFor } from '../secrets/store.js';
import { derivedApps } from '../workspace/derive.js';
import {
	getAppBuildOrder,
	getDeployTargetError,
	getPublicEnvPrefix,
	isDeployTargetSupported,
} from '../workspace/index.js';
import { assertDeployedStage } from '../workspace/stages.js';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';
import { applyDeclared, provisionDeclared } from './declared';
import { orchestrateDns, verifyDnsRecords } from './dns/index.js';
import { deployDocker } from './docker';
import { DokployApi, type DokployApplication } from './dokploy-api';
import { isMainFrontendApp, resolveHost } from './domain.js';
import {
	type EnvResolverContext,
	formatMissingVarsError,
	validateEnvVars,
} from './env-resolver.js';
import type { DokployCluster } from './fromManifest';
import { withGeneratedSecrets } from './generated.js';
import {
	applicationName,
	type DeployIdentity,
	deployIdentity,
	imageName,
	imageRef as imageRefFor,
	projectName,
} from './identity.js';
import { DeployJournal } from './journal.js';
import { resolveProject } from './ownership.js';
import { resolveRegistry } from './registry.js';
import {
	createStateStore,
	type StateStore,
	StateStoreBusy,
	StateVersionConflict,
} from './StateStore.js';
import { generateSecretsReport, prepareSecretsForAllApps } from './secrets.js';
import { sniffAllApps } from './sniffer.js';
import {
	createEmptyState,
	getBackupState,
	setApplicationId,
	setBackupState,
	setDeployedImage,
	setPostgresBackupId,
} from './state.js';
import type {
	AppDeployResult,
	DeployOptions,
	DeployProvider,
	DeployResult,
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
			// A socket that dies *after* connecting emits on the client, and an
			// unhandled 'error' event takes the whole process down — which is how
			// a deploy went from "retrying" to a Node stack trace mid-run. The
			// retry loop below is the thing that decides what to do about it.
			client.on('error', () => {});
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
			// See `waitForPostgres`: the port is only reachable while published,
			// and the container restarts around that change, so the socket can
			// drop mid-statement. Swallowed here and surfaced by the awaited
			// call, which the retry can actually act on.
			connection.on('error', () => {});

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
/**
 * The things this deploy creates a container for.
 *
 * A deploy unit is a *declaration*, not a config entry — and since that is now
 * true of every app, not just the ones being deployed, this is the workspace's
 * own derivation under the name the deploy phases call it by.
 */
export function deployUnits(
	manifest: ConstructManifest,
	workspace: NormalizedWorkspace,
): Record<string, NormalizedAppConfig> {
	return derivedApps(manifest, workspace);
}

/**
 * The variables an app cannot start without.
 *
 * The sniffer reports every key it saw in `requiredEnvVars` and says which of
 * them were read through `.optional()` or `.default()` in `optionalEnvVars`.
 * Reading only the first treats a key that is *absent by design* as a missing
 * secret — `AUTH_COOKIE_DOMAIN` is published only when a surface has a domain
 * to widen a cookie to, and one host has nothing to share it with.
 *
 * The same distinction `bundleServer` draws. It is drawn twice because the
 * bundle and the deploy each validate, and the deploy was the half still
 * failing on an answer that was correct.
 */
function requiredOf(
	requirements:
		| { requiredEnvVars: string[]; optionalEnvVars: string[] }
		| undefined,
): string[] {
	if (!requirements) return [];

	const optional = new Set(requirements.optionalEnvVars);

	return requirements.requiredEnvVars
		.map((name) => (name.endsWith('?') ? name.slice(0, -1) : name))
		.filter((name) => !optional.has(name));
}

export async function workspaceDeployCommand(
	configured: NormalizedWorkspace,
	options: DeployOptions,
): Promise<WorkspaceDeployResult> {
	const { provider, stage, tag, apps: selectedApps } = options;

	// What to deploy comes from the manifest.
	//
	// Discovered here rather than inside `provisionDeclared`, because the list of
	// things to build is the *declarations* — one `rest-api` is one server, one
	// `site` is one site — and the config only says how to run each. It read the
	// config before, which is why a declared site nobody had listed as an app was
	// silently never deployed, and why two surfaces in one app had to share a
	// container.
	//
	// A project that declares no surfaces keeps its configured apps, so adopting
	// constructs stays something you do a piece at a time.
	const manifest = await discover({
		patterns: constructGlobs(configured),
		cwd: configured.root,
	});
	const units = deployUnits(manifest, configured);
	const workspace: NormalizedWorkspace =
		Object.keys(units).length > 0 ? { ...configured, apps: units } : configured;

	if (provider !== 'dokploy') {
		throw new Error(
			`Workspace deployment only supports Dokploy. Got: ${provider}`,
		);
	}

	// What every project, image and application this deploy touches is named
	// and claimed by — resolved first, so a namespace that cannot be a name
	// fails before anything is built.
	const identity = deployIdentity(workspace, stage);

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
		if (target === 'sst') {
			logger.log(
				`   ⚠️  Skipping ${name}: it deploys with SST — run \`gkm build && sst deploy --stage ${stage}\``,
			);
			return false;
		}
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
	// LOCK: one deploy of a stage at a time
	// ==================================================================
	// Taken before anything is generated, provisioned or recorded, and held
	// until the run ends however it ends. A second run of the stage — another
	// CI job, a laptop — gets `StateLocked` naming this one instead of racing
	// it; a run killed with the lock held is released with `gkm state:unlock`.
	const store = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});
	const lock = await store.lock(stage, { operation: 'deploy' });

	try {
		return await deployLocked({
			workspace,
			manifest,
			stage,
			imageTag,
			appsToDeployNames,
			identity,
			store,
		});
	} finally {
		await lock.release();
	}
}

/** What the locked half of a deploy is handed by the half that validated. */
interface LockedDeploy {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	stage: string;
	imageTag: string;
	appsToDeployNames: string[];
	identity: DeployIdentity;
	store: StateStore;
}

/** Everything a deploy does while it holds the stage's lock. */
async function deployLocked({
	workspace,
	manifest,
	stage,
	imageTag,
	appsToDeployNames,
	identity,
	store,
}: LockedDeploy): Promise<WorkspaceDeployResult> {
	// ==================================================================
	// PREFLIGHT: Load secrets and sniff environment requirements
	// ==================================================================
	logger.log('\n🔐 Loading secrets and analyzing environment requirements...');

	// The stage's own store — SSM in its account, for a stage kept there.
	const secretsStore = await secretsStoreFor(workspace, stage);
	const stored = await secretsStore.read(stage);
	if (!stored) {
		logger.log(`   ⚠️  No secrets found for stage "${stage}"; starting them`);
	}

	// What the stage generates once — its seed, each `secret` construct's
	// value — written back before anything is provisioned with it, so the next
	// deploy derives the same passwords and signs with the same key.
	const { secrets: stageSecrets, generated } = withGeneratedSecrets(
		stored ?? initStageSecrets(stage),
		manifest,
	);
	if (generated.length > 0) {
		await secretsStore.write(stage, stageSecrets);
		logger.log(
			`   🔑 Generated for "${stage}" (${secretsStore.name}): ${generated.join(', ')}`,
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

	// ==================================================================
	// STATE: the stage's journal, written after every resource
	// ==================================================================
	// Before the project: the id it recorded is the first place the project is
	// looked for, and the only one that needs no ownership marker. A first
	// deploy writes an empty state now, so there is somewhere to record the
	// project before it is created.
	logger.log('\n📋 Loading deploy state...');

	const journal = await DeployJournal.open(store, stage, () =>
		createEmptyState(stage, '', ''),
	);
	const state = journal.state;
	if (journal.existed) {
		logger.log(`   Found existing state for stage "${stage}"`);
	} else {
		logger.log(`   Creating new state for stage "${stage}"`);
	}
	const unfinished = journal.unfinished();
	if (unfinished.length > 0) {
		logger.log(
			`   ⚠ A previous run stopped while creating: ${unfinished.join(', ')} — looking for them before creating anything`,
		);
	}

	// Find or create the project this identity owns
	logger.log('\n📁 Setting up Dokploy project...');
	logger.log(`   Identity: ${identity.key}`);
	const projectEntry = {
		key: 'project',
		type: 'project',
		data: { name: projectName(identity), identity: identity.key },
	};
	const project = await resolveProject(
		api,
		identity,
		state.projectId || undefined,
		(message) => logger.log(message),
		{ beforeCreate: () => journal.pending(projectEntry) },
	);
	await journal.ready(projectEntry, project.projectId);

	if (project.via === 'created') {
		logger.log(`   ✓ Created project: ${project.projectId}`);
	} else {
		logger.log(`   Found existing project: ${project.name}`);
	}

	const environmentEntry = {
		key: 'environment',
		type: 'environment',
		data: { name: stage },
	};
	const environment = await journal.ensure(environmentEntry, {
		// By name, in the project just resolved: an environment id from state
		// may belong to a project this deploy no longer uses.
		find: async () =>
			project.environments.find(
				(e) => e.name.toLowerCase() === stage.toLowerCase(),
			),
		create: () => {
			logger.log(`   Creating "${stage}" environment...`);
			return api.createEnvironment(project.projectId, stage);
		},
		id: (e) => e.environmentId,
	});
	const environmentId = environment.resource.environmentId;
	if (environment.via === 'created') {
		logger.log(`   ✓ Created environment: ${stage}`);
	} else {
		logger.log(`   Using environment: ${environment.resource.name}`);
	}

	if (journal.existed) {
		// Verify project ID matches (in case of recreation)
		if (state.projectId && state.projectId !== project.projectId) {
			logger.log(`   ⚠ Project ID changed, updating state`);
		}
		// Verify environment ID matches (in case of recreation)
		if (state.environmentId && state.environmentId !== environmentId) {
			logger.log(`   ⚠ Environment ID changed, updating state`);
		}
	}
	state.projectId = project.projectId;
	state.environmentId = environmentId;
	state.identity = identity.key;

	// The registry Dokploy pulls through, kept with the stage
	logger.log('\n🐳 Checking registry...');
	const registry = workspace.deploy.dokploy?.registry;
	const dokployRegistry = await resolveRegistry(api, {
		stage,
		registry,
		configuredId: workspace.deploy.dokploy?.registryId,
		stateId: state.registryId,
		log: (message) => logger.log(message),
		create: async (url) => {
			logger.log(`   Dokploy has no registry for ${url}. Let's create one.`);

			const username = await prompt('Registry username: ');
			const password = await prompt('Registry password/token: ', true);

			const created = await api.createRegistry(
				'Default Registry',
				url,
				username,
				password,
			);
			logger.log(`   ✓ Registry created: ${created.registryId}`);
			return created;
		},
	});
	const registryId = dokployRegistry.registryId;
	state.registryId = registryId;
	logger.log(`   Using registry: ${dokployRegistry.registryName}`);
	await journal.save();

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
				workspace.deploy?.domains,
				false,
			)}`;
		}

		const declared = await provisionDeclared({
			api,
			workspace,
			projectId: project.projectId,
			environmentId: environmentId as string,
			stage,
			scope: identity.scope,
			appUrls,
			// What the stage holds by key — a third party's credentials, and what
			// it generated — which a construct reads itself and the sniffer
			// therefore never sees.
			supplied: stageSecrets.custom,
			seed: stageSecrets.seed as string,
			// The one already discovered above, so a deploy reads the manifest once
			// and cannot act on two different versions of it.
			manifest,
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
			projectName: identity.scope,
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
			workspace.deploy?.domains,
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
				// Scoped exactly as a construct is, by the stage and the deploy
				// identity: an application's name is also its Docker service name,
				// unique on the whole server, so two workspaces called `shop`
				// cannot both run `production-shop-api`.
				const dokployAppName = applicationName(identity, appName);

				const application = await ensureApplication(
					api,
					journal,
					appName,
					dokployAppName,
					project.projectId,
					environmentId,
				);

				// Get encrypted secrets for this app
				const appSecrets = encryptedSecrets.get(appName);
				// A build secret, not build args: those are visible in `ps` and
				// recorded in the image history.
				const credentials =
					appSecrets && appSecrets.secretCount > 0
						? {
								encrypted: appSecrets.payload.encrypted,
								iv: appSecrets.payload.iv,
							}
						: undefined;

				if (appSecrets && credentials) {
					logger.log(`      Encrypted ${appSecrets.secretCount} secrets`);
				}

				// Build Docker image with encrypted secrets
				const imageRef = imageRefFor(identity, appName, registry, imageTag);

				logger.log(`      Building Docker image: ${imageRef}`);

				const built = await deployDocker({
					stage,
					tag: imageTag,
					skipPush: false,
					config: {
						registry,
						imageName: imageName(identity, appName),
						appName,
					},
					credentials,
				});
				setDeployedImage(state, appName, {
					ref: built.imageRef ?? imageRef,
					...(built.digest ? { digest: built.digest } : {}),
				});
				// The image is pushed: worth keeping even if what follows fails.
				await journal.save();

				// Compute hostname first (needed for BETTER_AUTH_URL)
				const backendHost = resolveHost(
					appName,
					app,
					stage,
					workspace.deploy?.domains,
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
				const sniffedVars = requiredOf(appRequirements);
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

				const domainId = await ensureDomain(
					api,
					journal,
					backendHost,
					app.port,
					application.applicationId,
				);
				appHostnames.set(appName, backendHost);
				if (domainId) appDomainIds.set(appName, domainId);
				publicUrls[appName] = `https://${backendHost}`;

				results.push({
					appName,
					type: app.type,
					success: true,
					applicationId: application.applicationId,
					imageRef,
					...(built.digest ? { digest: built.digest } : {}),
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
				// Scoped exactly as a construct is, by the stage and the deploy
				// identity: an application's name is also its Docker service name,
				// unique on the whole server, so two workspaces called `shop`
				// cannot both run `production-shop-api`.
				const dokployAppName = applicationName(identity, appName);

				const application = await ensureApplication(
					api,
					journal,
					appName,
					dokployAppName,
					project.projectId,
					environmentId,
				);

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
					workspace.deploy?.domains,
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
				const sniffedVars = requiredOf(sniffedApps.get(appName));
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
				const imageRef = imageRefFor(identity, appName, registry, imageTag);

				logger.log(`      Building Docker image: ${imageRef}`);

				const built = await deployDocker({
					stage,
					tag: imageTag,
					skipPush: false,
					config: {
						registry,
						imageName: imageName(identity, appName),
						appName,
					},
					buildArgs,
					// Pass arg names for Dockerfile ARG generation
					publicUrlArgs: publicUrlArgNames,
				});
				setDeployedImage(state, appName, {
					ref: built.imageRef ?? imageRef,
					...(built.digest ? { digest: built.digest } : {}),
				});
				// The image is pushed: worth keeping even if what follows fails.
				await journal.save();

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

				const domainId = await ensureDomain(
					api,
					journal,
					frontendHost,
					app.port,
					application.applicationId,
				);
				appHostnames.set(appName, frontendHost);
				if (domainId) appDomainIds.set(appName, domainId);
				publicUrls[appName] = `https://${frontendHost}`;

				results.push({
					appName,
					type: app.type,
					success: true,
					applicationId: application.applicationId,
					imageRef,
					...(built.digest ? { digest: built.digest } : {}),
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
	await journal.save();
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
			await journal.save();
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
 * An app's Dokploy application, through the journal: by the id recorded for
 * it, else by its name in the stage's environment, else created. Its id goes
 * into `state.applications` too, which the env resolver and `state:show` read.
 */
async function ensureApplication(
	api: DokployApi,
	journal: DeployJournal,
	appName: string,
	dokployAppName: string,
	projectId: string,
	environmentId: string,
): Promise<DokployApplication> {
	const recorded = journal.record(`application:${appName}`);
	if (recorded?.status === 'ready' && recorded.id) {
		logger.log(`      Using cached ID: ${recorded.id}`);
	}

	const { resource, via, staleId } = await journal.ensure(
		{
			key: `application:${appName}`,
			type: 'application',
			data: { name: dokployAppName },
		},
		{
			get: (id) => api.getApplication(id),
			find: () =>
				api.findApplicationByName(projectId, dokployAppName, environmentId),
			create: () =>
				api.createApplication(dokployAppName, projectId, environmentId),
			id: (application) => application.applicationId,
		},
	);

	if (staleId) logger.log(`      ⚠ Cached ID invalid, will create new`);
	const said: Record<typeof via, string> = {
		recorded: '✓ Application found',
		resumed: 'Resumed application a stopped run created',
		found: 'Found existing application',
		created: 'Created application',
	};
	logger.log(`      ${said[via]}: ${resource.applicationId}`);

	setApplicationId(journal.state, appName, resource.applicationId);
	return resource;
}

/**
 * The domain `host` routes to an application, through the journal — found on
 * the application before it is created, so a re-run never adds a second.
 *
 * A domain that cannot be created is reported and skipped rather than
 * failing the app: the application is deployed and reachable on Dokploy's
 * own address, and DNS is fixed by hand more easily than a half deploy.
 */
async function ensureDomain(
	api: DokployApi,
	journal: DeployJournal,
	host: string,
	port: number,
	applicationId: string,
): Promise<string | undefined> {
	try {
		const { resource, via } = await journal.ensure(
			{ key: `domain:${host}`, type: 'domain', data: { host, applicationId } },
			{
				find: async () =>
					(await api.getDomainsByApplicationId(applicationId)).find(
						(d) => d.host === host,
					),
				create: () =>
					api.createDomain({
						host,
						port,
						https: true,
						certificateType: 'letsencrypt',
						applicationId,
					}),
				id: (domain) => domain.domainId,
			},
		);
		logger.log(
			`      ✓ Domain: https://${host} (${via === 'created' ? 'created' : 'existing'})`,
		);
		return resource.domainId;
	} catch (domainError) {
		// The state store failing is not a domain failing: a conflict means
		// another run wrote the stage, and carrying on would overwrite it.
		if (
			domainError instanceof StateVersionConflict ||
			domainError instanceof StateStoreBusy
		) {
			throw domainError;
		}
		const message =
			domainError instanceof Error ? domainError.message : 'Unknown error';
		logger.log(`      ⚠ Domain creation failed: ${message}`);
		return undefined;
	}
}

/**
 * Main deploy command
 */
export async function deployCommand(
	options: DeployOptions,
): Promise<DeployResult | WorkspaceDeployResult> {
	// Load config with workspace detection
	const loadedConfig = await loadWorkspaceConfig();

	// Before anything is provisioned: a typo'd stage would otherwise create a
	// whole second environment under the wrong name.
	assertDeployedStage(loadedConfig.workspace.stages, options.stage);

	// One path, whatever the config was written as.
	//
	// `defineConfig` is sugar over a one-app workspace, and `processConfig`
	// already projects it into the same `NormalizedWorkspace` a `defineWorkspace`
	// produces — so branching here meant a single-app project silently got less.
	// Domains were the clearest case: `createDomain` is only reached from this
	// function, so a single-app deploy provisioned everything, pushed an image,
	// started a container, and left nothing routing to it.
	return workspaceDeployCommand(loadedConfig.workspace, options);
}

export type { DeployOptions, DeployProvider, DeployResult };
