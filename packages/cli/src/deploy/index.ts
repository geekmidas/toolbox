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
import { resolve } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { Client as PgClient } from 'pg';
import { loadWorkspaceConfig } from '../config';
import { output } from '../output';
import { discover } from '../reconcile/discover.js';
import type { SqlClient, Statement } from '../reconcile/provision.js';
import { constructGlobs } from '../reconcile/workspace.js';
import type { RunOptions } from '../run';
import { initStageSecrets } from '../secrets/storage.js';
import { secretsStoreFor } from '../secrets/store.js';
import type { StageSecrets } from '../secrets/types.js';
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
import { type CredentialProvider, MissingCredential } from './credentials';
import { applyDeclared, provisionDeclared } from './declared';
import { orchestrateDns, verifyDnsRecords } from './dns/index.js';
import { deployDocker } from './docker';
import {
	DokployApi,
	type DokployApplication,
	type DokployRegistry,
} from './dokploy-api';
import { isMainFrontendApp, resolveHost } from './domain.js';
import {
	type EnvResolverContext,
	formatMissingVarsError,
	validateEnvVars,
} from './env-resolver.js';
import {
	type DeployEvent,
	eventError,
	type ResourceChange,
	type ResourceVia,
} from './events';
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
import {
	findProject,
	type ResolvedProject,
	resolveProject,
} from './ownership.js';
import { resolveRegistry } from './registry.js';
import {
	createStateStore,
	type StateStore,
	StateStoreBusy,
	StateVersionConflict,
} from './StateStore.js';
import {
	type EncryptedAppSecrets,
	generateSecretsReport,
	prepareSecretsForAllApps,
} from './secrets.js';
import { type SniffedEnvironment, sniffAllApps } from './sniffer.js';
import {
	createEmptyState,
	getBackupState,
	setApplicationId,
	setBackupState,
	setDeployedImage,
	setPostgresBackupId,
} from './state.js';
import { terminalCredentials } from './terminal';
import type {
	AppDeployResult,
	DeployOptions,
	DeployProvider,
	DeployResult,
} from './types';

// Through `output`: the console from the terminal, the run's own events
// inside `deploy()`.
const logger = output;

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
	throw new PostgresNotReady(host, port, maxRetries);
}

/** A Postgres published for the role DDL never accepted a connection. */
export class PostgresNotReady extends Error {
	constructor(
		readonly host: string,
		readonly port: number,
		readonly attempts: number,
	) {
		super(
			`Postgres not ready after ${attempts} retries (${host}:${port}). Check that the port is reachable from here — a firewall in front of the server drops it silently — and deploy again.`,
		);
		this.name = 'PostgresNotReady';
	}
}

/** No port could be published for a cluster, so its DDL cannot reach it. */
export class PostgresPortUnavailable extends Error {
	constructor(
		readonly appName: string,
		readonly taken: readonly number[],
	) {
		super(
			`Could not publish a port for ${appName}. ` +
				`In use on this server: ${[...taken].sort((a, b) => a - b).join(', ') || 'none reported'}. ` +
				`The role DDL needs to reach the cluster from here.`,
		);
		this.name = 'PostgresPortUnavailable';
	}
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
			throw new PostgresPortUnavailable(postgres.appName, [...taken]);
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

/** What a run deploys, once the workspace is loaded. */
export interface DeployRequest {
	/** Deployment stage (e.g., 'production', 'staging') */
	stage: string;
	/** Image tag (default: stage-timestamp) */
	tag?: string;
	/** Specific apps to deploy (default: all) */
	apps?: string[];
}

/**
 * What a run is handed by whoever started it: where its events go, where it
 * gets credentials, and whether it may change anything. Nothing in a run
 * reads a terminal or exits the process — that is its caller's business.
 */
export interface DeployContext {
	emit: (event: DeployEvent) => void;
	credentials: CredentialProvider;
	signal?: AbortSignal;
	/** Look everything up, create, build and push nothing. */
	dryRun: boolean;
	/** The CLI's home, for the stage's keys. Defaults to `GKM_HOME`. */
	home?: string;
	/** Where docker's own output goes. Defaults to the terminal. */
	stdio?: RunOptions['stdio'];
}

/** Apps were asked for by name that the workspace does not have. */
export class UnknownDeployApps extends Error {
	constructor(
		readonly apps: readonly string[],
		readonly available: readonly string[],
	) {
		super(
			`Unknown apps: ${apps.join(', ')}\n` +
				`Available apps: ${available.join(', ')}`,
		);
		this.name = 'UnknownDeployApps';
	}
}

/** Every app asked for deploys somewhere other than Dokploy. */
export class NoDeployableApps extends Error {
	constructor(readonly stage: string) {
		super(
			'No apps to deploy. All selected apps have unsupported deploy targets.',
		);
		this.name = 'NoDeployableApps';
	}
}

/** A backend failed, so the run stopped before deploying anything after it. */
export class BackendDeployFailed extends Error {
	constructor(
		readonly app: string,
		cause: unknown,
	) {
		super(
			`Backend deployment failed for ${app}. Aborting to prevent partial deployment.`,
			{ cause },
		);
		this.name = 'BackendDeployFailed';
	}
}

/** An app's environment needs values the stage does not have. */
export class MissingEnvVars extends Error {
	constructor(
		readonly app: string,
		readonly missing: readonly string[],
		readonly stage: string,
	) {
		super(formatMissingVarsError(app, [...missing], stage));
		this.name = 'MissingEnvVars';
	}
}

/** Workspace deploys go to Dokploy; another provider was asked for. */
export class DeployProviderUnsupported extends Error {
	constructor(readonly provider: string) {
		super(`Workspace deployment only supports Dokploy. Got: ${provider}`);
		this.name = 'DeployProviderUnsupported';
	}
}

/** How `resolveProject` found a project, in the journal's words. */
const PROJECT_VIA: Record<ResolvedProject['via'], ResourceVia> = {
	state: 'recorded',
	marker: 'found',
	created: 'created',
};

/**
 * Deploy every app in a workspace to Dokploy.
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
 * The engine under `deploy()` and `gkm deploy`. It never prompts and never
 * exits: credentials come from `ctx.credentials`, progress goes to
 * `ctx.emit` and to `output`, and every failure is thrown.
 *
 * @internal
 */
export async function runDeploy(
	source: NormalizedWorkspace | (() => Promise<NormalizedWorkspace>),
	request: DeployRequest,
	ctx: DeployContext,
): Promise<DeployResult> {
	const { stage, tag, apps: selectedApps } = request;
	ctx.emit({ type: 'phase.started', phase: 'validate' });
	const configured = typeof source === 'function' ? await source() : source;

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
			throw new UnknownDeployApps(invalidApps, Object.keys(workspace.apps));
		}
		// Keep only selected apps, but maintain dependency order
		appsToDeployNames = buildOrder.filter((name) =>
			selectedApps.includes(name),
		);
		logger.log(`   Deploying apps: ${appsToDeployNames.join(', ')}`);
	} else {
		logger.log(`   Deploying all apps: ${appsToDeployNames.join(', ')}`);
	}

	const skipped: DeployResult['skipped'] = [];
	const skip = (app: string, reason: string) => {
		skipped.push({ app, reason });
		ctx.emit({ type: 'app.skipped', app, reason });
	};

	// Filter apps by deploy target
	const dokployApps = appsToDeployNames.filter((name) => {
		const app = workspace.apps[name]!;
		const target = app.resolvedDeployTarget;
		if (target === 'sst') {
			const reason = `it deploys with SST — run \`gkm build && sst deploy --stage ${stage}\``;
			logger.log(`   ⚠️  Skipping ${name}: ${reason}`);
			skip(name, reason);
			return false;
		}
		if (!isDeployTargetSupported(target)) {
			const reason = getDeployTargetError(target, name);
			logger.log(`   ⚠️  Skipping ${name}: ${reason}`);
			skip(name, reason);
			return false;
		}
		return true;
	});

	if (dokployApps.length === 0) {
		throw new NoDeployableApps(stage);
	}

	appsToDeployNames = dokployApps;

	// Mobile apps deploy via their own toolchain (e.g. EAS Build for Expo).
	// They stay in the list, for the line that says they were skipped.
	for (const name of appsToDeployNames) {
		if (workspace.apps[name]!.type === 'mobile') skip(name, MOBILE_SKIP_REASON);
	}

	ctx.emit({
		type: 'deploy.started',
		stage,
		identity: identity.key,
		tag: imageTag,
		apps: appsToDeployNames.filter(
			(name) => workspace.apps[name]!.type !== 'mobile',
		),
		dryRun: ctx.dryRun,
	});

	const store = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});
	const run: LockedDeploy = {
		workspace,
		manifest,
		stage,
		imageTag,
		appsToDeployNames,
		identity,
		store,
		skipped,
		ctx,
	};

	// A dry run takes no lock: it writes nothing a lock would protect, and it
	// should not stop a real deploy that starts while it is looking.
	if (ctx.dryRun) return planDeploy(run);

	// ==================================================================
	// LOCK: one deploy of a stage at a time
	// ==================================================================
	// Taken before anything is generated, provisioned or recorded, and held
	// until the run ends however it ends. A second run of the stage — another
	// CI job, a laptop — gets `StateLocked` naming this one instead of racing
	// it; a run killed with the lock held is released with `gkm state:unlock`.
	const lock = await store.lock(stage, { operation: 'deploy' });

	try {
		return await deployLocked(run);
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
	skipped: DeployResult['skipped'];
	ctx: DeployContext;
}

/** What the preflight found: the stage's secrets and what each app reads. */
interface Preflight {
	stageSecrets: StageSecrets;
	sniffedApps: Map<string, SniffedEnvironment>;
	encryptedSecrets: Map<string, EncryptedAppSecrets>;
}

/**
 * The stage's secrets and every app's environment requirements. A dry run
 * reads the secrets and generates nothing into the store.
 */
async function preflight({
	workspace,
	manifest,
	stage,
	ctx,
}: LockedDeploy): Promise<Preflight> {
	logger.log('\n🔐 Loading secrets and analyzing environment requirements...');

	// The stage's own store — SSM in its account, for a stage kept there.
	const secretsStore = await secretsStoreFor(workspace, stage, {
		...(ctx.home ? { home: ctx.home } : {}),
	});
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
		if (ctx.dryRun) {
			logger.log(
				`   🔑 Would generate for "${stage}" (${secretsStore.name}): ${generated.join(', ')}`,
			);
		} else {
			await secretsStore.write(stage, stageSecrets);
			logger.log(
				`   🔑 Generated for "${stage}" (${secretsStore.name}): ${generated.join(', ')}`,
			);
		}
	}

	// Sniff environment variables for all apps
	const sniffedApps = await sniffAllApps(workspace.apps, workspace.root);

	// Prepare encrypted secrets for backend apps
	const encryptedSecrets = stageSecrets
		? prepareSecretsForAllApps(stageSecrets, sniffedApps)
		: new Map<string, EncryptedAppSecrets>();

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

	return { stageSecrets, sniffedApps, encryptedSecrets };
}

/** Everything a deploy does while it holds the stage's lock. */
async function deployLocked(run: LockedDeploy): Promise<DeployResult> {
	const {
		workspace,
		manifest,
		stage,
		imageTag,
		appsToDeployNames,
		identity,
		store,
		ctx,
	} = run;

	// ==================================================================
	// PREFLIGHT: Load secrets and sniff environment requirements
	// ==================================================================
	const { stageSecrets, sniffedApps, encryptedSecrets } = await preflight(run);
	ctx.emit({ type: 'phase.finished', phase: 'validate' });

	const changes: ResourceChange[] = [];
	const applied: Applied = (change, via) => {
		changes.push(change);
		ctx.emit({ type: 'resource.applied', ...change, via });
	};

	ctx.signal?.throwIfAborted();
	ctx.emit({ type: 'phase.started', phase: 'provision' });

	// ==================================================================
	// SETUP: Credentials, Project, Registry
	// ==================================================================
	const { api, endpoint } = await dokployApi(workspace, ctx);

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
	applied(
		{
			key: 'project',
			resourceType: 'project',
			action: project.via === 'created' ? 'create' : 'reuse',
			id: project.projectId,
		},
		PROJECT_VIA[project.via],
	);

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
	applied(
		{
			key: 'environment',
			resourceType: 'environment',
			action: environment.via === 'created' ? 'create' : 'reuse',
			id: environmentId,
		},
		environment.via,
	);
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
	let registryCreated = false;
	const dokployRegistry = await resolveRegistry(api, {
		stage,
		registry,
		configuredId: workspace.deploy.dokploy?.registryId,
		stateId: state.registryId,
		log: (message) => logger.log(message),
		// Dokploy has nothing for the configured registry, so it needs a login
		// to pull with — from the run's provider, never from a prompt here.
		create: async (url) => {
			const login = await ctx.credentials.get(
				{ kind: 'registry', url },
				{ signal: ctx.signal },
			);
			if (!login) throw new MissingCredential('registry', url);

			const created = await api.createRegistry(
				'Default Registry',
				url,
				login.username,
				login.password,
			);
			registryCreated = true;
			logger.log(`   ✓ Registry created: ${created.registryId}`);
			return created;
		},
	});
	const registryId = dokployRegistry.registryId;
	state.registryId = registryId;
	applied(
		{
			key: 'registry',
			resourceType: 'registry',
			action: registryCreated ? 'create' : 'reuse',
			id: registryId,
		},
		registryCreated ? 'created' : 'found',
	);
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
		for (const appName of appsToDeployNames) {
			if (workspace.apps[appName]?.type !== 'backend') continue;
			appUrls[appName] = `https://${hostOf(workspace, appName, stage)}`;
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
			const serverHostname = getServerHostname(endpoint);

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

	ctx.emit({ type: 'phase.finished', phase: 'provision' });

	// ==================================================================
	// Separate apps by type for two-phase deployment
	// ==================================================================
	const backendApps = appsToDeployNames.filter(
		(name) => workspace.apps[name]!.type === 'backend',
	);
	const frontendApps = appsToDeployNames.filter(
		(name) => workspace.apps[name]!.type === 'web',
	);

	// Track deployed app public URLs for frontend builds
	const publicUrls: Record<string, string> = {};
	const results: AppDeployResult[] = [];

	// Track domain IDs and hostnames for DNS orchestration
	const appHostnames = new Map<string, string>(); // appName -> hostname
	const appDomainIds = new Map<string, string>(); // appName -> domainId

	/** An app is up: say so, and remember where. */
	const deployed = (
		appName: string,
		result: Omit<AppDeployResult, 'success'> & {
			applicationId: string;
			imageRef: string;
		},
		host: string,
	) => {
		const url = `https://${host}`;
		results.push({ ...result, success: true, url });
		ctx.emit({
			type: 'app.deployed',
			app: appName,
			applicationId: result.applicationId,
			imageRef: result.imageRef,
			url,
		});
	};

	/** An app failed: say so, and record it in the result. */
	const failed = (
		appName: string,
		app: NormalizedAppConfig,
		error: unknown,
	) => {
		const message = error instanceof Error ? error.message : 'Unknown error';
		logger.log(`      ✗ Failed to deploy ${appName}: ${message}`);
		results.push({ appName, type: app.type, success: false, error: message });
		ctx.emit({ type: 'app.failed', app: appName, error: eventError(error) });
	};

	/** An image is pushed: worth keeping even if what follows fails. */
	const built = async (
		appName: string,
		image: { imageRef?: string; digest?: string },
		ref: string,
	) => {
		setDeployedImage(state, appName, {
			ref: image.imageRef ?? ref,
			...(image.digest ? { digest: image.digest } : {}),
		});
		await journal.save();
		ctx.emit({
			type: 'artifact.built',
			app: appName,
			imageRef: image.imageRef ?? ref,
			...(image.digest ? { digest: image.digest } : {}),
		});
		changes.push({
			key: `image:${appName}`,
			resourceType: 'image',
			action: 'build',
			id: image.digest ?? image.imageRef ?? ref,
		});
	};

	// ==================================================================
	// PRE-COMPUTE: Frontend URLs for BETTER_AUTH_TRUSTED_ORIGINS
	// ==================================================================
	const frontendUrls: string[] = [];
	for (const appName of frontendApps) {
		frontendUrls.push(`https://${hostOf(workspace, appName, stage)}`);
	}

	ctx.signal?.throwIfAborted();
	ctx.emit({ type: 'phase.started', phase: 'release' });
	// ==================================================================
	// PHASE 1: Deploy backend apps (with encrypted secrets)
	// ==================================================================
	if (backendApps.length > 0) {
		logger.log('\n📦 PHASE 1: Deploying backend applications...');

		for (const appName of backendApps) {
			ctx.signal?.throwIfAborted();
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
					applied,
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

				const image = await deployDocker({
					stage,
					tag: imageTag,
					skipPush: false,
					config: {
						registry,
						imageName: imageName(identity, appName),
						appName,
					},
					credentials,
					...dockerRun(workspace, app, ctx),
				});
				await built(appName, image, imageRef);

				// Compute hostname first (needed for BETTER_AUTH_URL)
				const backendHost = hostOf(workspace, appName, stage);

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
					throw new MissingEnvVars(appName, missing, stage);
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
					applied,
				);
				appHostnames.set(appName, backendHost);
				if (domainId) appDomainIds.set(appName, domainId);
				publicUrls[appName] = `https://${backendHost}`;

				deployed(
					appName,
					{
						appName,
						type: app.type,
						applicationId: application.applicationId,
						imageRef,
						...(image.digest ? { digest: image.digest } : {}),
					},
					backendHost,
				);

				logger.log(`      ✓ ${appName} deployed successfully`);
			} catch (error) {
				// The caller stopping the run is not this app failing.
				if (ctx.signal?.aborted) throw ctx.signal.reason;
				failed(appName, app, error);

				// Abort on backend failure to prevent incomplete deployment
				throw new BackendDeployFailed(appName, error);
			}
		}
	}

	// ==================================================================
	// PHASE 2: Deploy frontend apps (with public URLs from backends)
	// ==================================================================
	if (frontendApps.length > 0) {
		logger.log('\n🌐 PHASE 2: Deploying frontend applications...');

		for (const appName of frontendApps) {
			ctx.signal?.throwIfAborted();
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
					applied,
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
				const frontendHost = hostOf(workspace, appName, stage);

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
					throw new MissingEnvVars(appName, missing, stage);
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

				const image = await deployDocker({
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
					...dockerRun(workspace, app, ctx),
				});
				await built(appName, image, imageRef);

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
					applied,
				);
				appHostnames.set(appName, frontendHost);
				if (domainId) appDomainIds.set(appName, domainId);
				publicUrls[appName] = `https://${frontendHost}`;

				deployed(
					appName,
					{
						appName,
						type: app.type,
						applicationId: application.applicationId,
						imageRef,
						...(image.digest ? { digest: image.digest } : {}),
					},
					frontendHost,
				);

				logger.log(`      ✓ ${appName} deployed successfully`);
			} catch (error) {
				// The caller stopping the run is not this app failing.
				if (ctx.signal?.aborted) throw ctx.signal.reason;
				failed(appName, app, error);
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
	ctx.emit({ type: 'phase.finished', phase: 'release' });

	ctx.signal?.throwIfAborted();
	ctx.emit({ type: 'phase.started', phase: 'verify' });
	// ==================================================================
	// DNS: Create DNS records, verify propagation, and validate for SSL
	// ==================================================================
	const dnsConfig = workspace.deploy.dns;
	if (dnsConfig && appHostnames.size > 0) {
		const dnsResult = await orchestrateDns(appHostnames, dnsConfig, endpoint);

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
	ctx.emit({ type: 'phase.finished', phase: 'verify' });

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
		environmentId,
		successCount,
		failedCount,
		stage,
		identity: identity.key,
		tag: imageTag,
		dryRun: false,
		skipped: run.skipped,
		urls: publicUrls,
		changes,
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
	applied: Applied,
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
	applied(
		{
			key: `application:${appName}`,
			resourceType: 'application',
			action: via === 'created' ? 'create' : 'reuse',
			id: resource.applicationId,
		},
		via,
	);

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
	applied: Applied,
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
		applied(
			{
				key: `domain:${host}`,
				resourceType: 'domain',
				action: via === 'created' ? 'create' : 'reuse',
				id: resource.domainId,
			},
			via,
		);
		return resource.domainId;
	} catch (domainError) {
		// The state store failing is not a domain failing: a conflict means
		// another run wrote the stage, and carrying on would overwrite it. Nor
		// is the caller stopping the run.
		if (
			domainError instanceof StateVersionConflict ||
			domainError instanceof StateStoreBusy ||
			isAbort(domainError)
		) {
			throw domainError;
		}
		const message =
			domainError instanceof Error ? domainError.message : 'Unknown error';
		logger.log(`      ⚠ Domain creation failed: ${message}`);
		return undefined;
	}
}

/** Whether `error` is a run being stopped rather than something failing. */
function isAbort(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

/** Records a resource the run created or found, and tells the caller. */
type Applied = (
	change: ResourceChange & { id: string },
	via: ResourceVia,
) => void;

/** Where docker runs for one app: in the app's own directory. */
function dockerRun(
	workspace: NormalizedWorkspace,
	app: NormalizedAppConfig,
	ctx: DeployContext,
): { cwd: string; signal?: AbortSignal; stdio?: RunOptions['stdio'] } {
	return {
		// The app's own directory, never the process's: a deploy started from
		// the workspace root — or by a host whose working directory is its own
		// — still builds each app from where its bundle is.
		cwd: resolve(workspace.root, app.path),
		...(ctx.signal ? { signal: ctx.signal } : {}),
		...(ctx.stdio ? { stdio: ctx.stdio } : {}),
	};
}

/** The Dokploy login, from the run's provider, or `MissingCredential`. */
async function dokployApi(
	workspace: NormalizedWorkspace,
	ctx: DeployContext,
): Promise<{ api: DokployApi; endpoint: string }> {
	const configured = workspace.deploy.dokploy?.endpoint;
	const creds = await ctx.credentials.get(
		{ kind: 'dokploy', ...(configured ? { endpoint: configured } : {}) },
		{ signal: ctx.signal },
	);
	if (!creds) throw new MissingCredential('dokploy', configured);

	return {
		api: new DokployApi({
			baseUrl: creds.endpoint,
			token: creds.token,
			...(ctx.signal ? { signal: ctx.signal } : {}),
		}),
		endpoint: creds.endpoint,
	};
}

/** Each app's public host, the same way the deploy resolves it. */
function hostOf(
	workspace: NormalizedWorkspace,
	appName: string,
	stage: string,
): string {
	const app = workspace.apps[appName]!;
	return resolveHost(
		appName,
		app,
		stage,
		workspace.deploy?.domains,
		app.type === 'web' && isMainFrontendApp(appName, app, workspace.apps),
	);
}

/**
 * What a deploy would do, from the same lookups it starts with — and nothing
 * else: no lock, no state written, no secret generated, no Dokploy resource
 * created or changed, no image built or pushed.
 */
async function planDeploy(run: LockedDeploy): Promise<DeployResult> {
	const { workspace, manifest, stage, imageTag, appsToDeployNames, identity } =
		run;
	const { ctx } = run;

	await preflight(run);
	ctx.emit({ type: 'phase.finished', phase: 'validate' });

	ctx.signal?.throwIfAborted();
	ctx.emit({ type: 'phase.started', phase: 'plan' });
	logger.log(
		'\n🔎 Dry run: nothing will be created, changed, built or pushed.',
	);

	const changes: ResourceChange[] = [];
	const plan = (change: ResourceChange, detail: string) => {
		changes.push(change);
		ctx.emit({ type: 'resource.planned', ...change });
		const sign = change.action === 'reuse' ? '=' : '+';
		logger.log(`   ${sign} ${change.action} ${change.key} (${detail})`);
	};

	const { api } = await dokployApi(workspace, ctx);
	const state = (await run.store.read(stage))?.state;

	const project = await findProject(api, identity, state?.projectId);
	if (project) {
		plan(
			{
				key: 'project',
				resourceType: 'project',
				action: 'reuse',
				id: project.projectId,
			},
			project.needsClaim
				? `${project.name}, would be claimed for ${identity.key}`
				: project.name,
		);
	} else {
		plan(
			{ key: 'project', resourceType: 'project', action: 'create' },
			projectName(identity),
		);
	}

	const environment = project?.environments.find(
		(e) => e.name.toLowerCase() === stage.toLowerCase(),
	);
	plan(
		environment
			? {
					key: 'environment',
					resourceType: 'environment',
					action: 'reuse',
					id: environment.environmentId,
				}
			: { key: 'environment', resourceType: 'environment', action: 'create' },
		stage,
	);

	let registryPlanned: ResourceChange | undefined;
	const registry = await resolveRegistry(api, {
		stage,
		registry: workspace.deploy.dokploy?.registry,
		configuredId: workspace.deploy.dokploy?.registryId,
		stateId: state?.registryId,
		log: (message) => logger.log(message),
		// Planned, not made: what a deploy would create is recorded instead.
		create: async (url) => {
			registryPlanned = {
				key: 'registry',
				resourceType: 'registry',
				action: 'create',
			};
			return { registryId: '', registryName: url } as DokployRegistry;
		},
	});
	plan(
		registryPlanned ?? {
			key: 'registry',
			resourceType: 'registry',
			action: 'reuse',
			id: registry.registryId,
		},
		registry.registryName,
	);

	for (const [id, declaration] of Object.entries(manifest)) {
		plan(
			{
				key: `construct:${id}`,
				resourceType: declaration.kind,
				action: 'ensure',
			},
			declaration.kind,
		);
	}

	const apps: AppDeployResult[] = [];
	const urls: Record<string, string> = {};
	for (const appName of appsToDeployNames) {
		const app = workspace.apps[appName]!;
		if (app.type === 'mobile') continue;

		const dokployAppName = applicationName(identity, appName);
		const recordedId = state?.applications?.[appName];
		const existing =
			project && environment
				? ((recordedId
						? await api.getApplication(recordedId).catch(() => null)
						: null) ??
					(await api.findApplicationByName(
						project.projectId,
						dokployAppName,
						environment.environmentId,
					)))
				: null;
		plan(
			existing
				? {
						key: `application:${appName}`,
						resourceType: 'application',
						action: 'reuse',
						id: existing.applicationId,
					}
				: {
						key: `application:${appName}`,
						resourceType: 'application',
						action: 'create',
					},
			dokployAppName,
		);

		const ref = imageRefFor(
			identity,
			appName,
			workspace.deploy.dokploy?.registry,
			imageTag,
		);
		plan(
			{ key: `image:${appName}`, resourceType: 'image', action: 'build' },
			ref,
		);

		const host = hostOf(workspace, appName, stage);
		const domain = existing
			? (await api.getDomainsByApplicationId(existing.applicationId)).find(
					(d) => d.host === host,
				)
			: undefined;
		plan(
			domain
				? {
						key: `domain:${host}`,
						resourceType: 'domain',
						action: 'reuse',
						id: domain.domainId,
					}
				: { key: `domain:${host}`, resourceType: 'domain', action: 'create' },
			`https://${host}`,
		);

		urls[appName] = `https://${host}`;
		apps.push({
			appName,
			type: app.type,
			success: true,
			imageRef: ref,
			url: urls[appName],
			...(existing ? { applicationId: existing.applicationId } : {}),
		});
	}

	const creates = changes.filter((c) => c.action !== 'reuse').length;
	logger.log(
		`\n✅ Dry run complete: ${creates} to create or build, ${changes.length - creates} to reuse.`,
	);

	ctx.emit({ type: 'phase.finished', phase: 'plan' });
	return {
		apps,
		projectId: project?.projectId ?? '',
		environmentId: environment?.environmentId ?? '',
		successCount: apps.length,
		failedCount: 0,
		stage,
		identity: identity.key,
		tag: imageTag,
		dryRun: true,
		skipped: run.skipped,
		urls,
		changes,
	};
}

/** Why a mobile app is left out of a Dokploy deploy. */
const MOBILE_SKIP_REASON = 'deploys via its framework toolchain';

// ==================================================================
// The command, as it was called before `deploy()`
// ==================================================================

/**
 * Deploy a loaded workspace, printing to the terminal and prompting for
 * missing credentials there.
 *
 * @deprecated Use `deploy({ cwd, stage })` from `@geekmidas/cli/deploy`,
 * which never prompts or prints and reports progress as events. This wrapper
 * is kept for one alpha.
 */
export async function workspaceDeployCommand(
	workspace: NormalizedWorkspace,
	options: DeployOptions,
): Promise<DeployResult> {
	if (options.provider !== 'dokploy') {
		throw new DeployProviderUnsupported(options.provider);
	}

	// No sink: `output` falls back to the console, which is what this always
	// printed to.
	return runDeploy(
		workspace,
		{
			stage: options.stage,
			...(options.tag ? { tag: options.tag } : {}),
			...(options.apps ? { apps: options.apps } : {}),
		},
		{
			emit: () => {},
			credentials: terminalCredentials(),
			dryRun: false,
		},
	);
}

/**
 * Deploy the workspace in the current directory.
 *
 * @deprecated Use `deploy({ cwd: process.cwd(), stage })` from
 * `@geekmidas/cli/deploy`. Kept for one alpha.
 */
export async function deployCommand(
	options: DeployOptions,
): Promise<DeployResult> {
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
