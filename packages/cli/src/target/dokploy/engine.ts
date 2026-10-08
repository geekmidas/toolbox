/**
 * The Dokploy engine: what the built-in `dokploy` target runs, phase by phase.
 *
 * ```
 * gkm deploy --stage production
 *   ├─ validate   the stage's secrets, what each app reads
 *   ├─ provision  project, environment, registry; declared constructs —
 *   │             each database's roles applied over a port published
 *   │             for the purpose
 *   ├─ release    migrations (over that port, then closed); each backend
 *   │             built, pushed, deployed and waited on, then checked;
 *   │             then each site
 *   ├─ verify     each site checked
 *   └─ rollback   on a failed release or verify: what failed (or, atomic,
 *                 everything released) back on the image it ran before
 * ```
 *
 * Every app's database URL names its cluster's service on Dokploy's network,
 * never the server's public address; only the deploy reaches the cluster from
 * outside, and only while a step needs it.
 *
 * @module deploy
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import { type WorkerUnit, workerUnits } from '../../build/workers.js';
import {
	type CredentialProvider,
	MissingCredential,
} from '../../deploy/credentials';
import {
	assertExternalServices,
	type DevService,
	devServicesUsed,
	manifestServiceDeclarations,
	reportDevServices,
} from '../../deploy/devServices.js';
import { deployDocker } from '../../deploy/docker';
import {
	eventError,
	type ResourceChange,
	type ResourceVia,
} from '../../deploy/events';
import { withGeneratedSecrets } from '../../deploy/generated.js';
import {
	applicationName,
	type DeployIdentity,
	imageName,
	imageRef as imageRefFor,
	projectName,
} from '../../deploy/identity.js';
import { DeployJournal } from '../../deploy/journal.js';
import {
	findProject,
	type ResolvedProject,
	resolveProject,
} from '../../deploy/ownership.js';
import { resolveRegistry } from '../../deploy/registry.js';
import {
	type StateStore,
	StateStoreBusy,
	StateVersionConflict,
} from '../../deploy/StateStore.js';
import {
	type EncryptedAppSecrets,
	generateSecretsReport,
	prepareSecretsForAllApps,
	prepareSecretsForApp,
} from '../../deploy/secrets.js';
import { type SniffedEnvironment, sniffAllApps } from '../../deploy/sniffer.js';
import {
	createEmptyState,
	type DeployedImage,
	getBackupState,
	recordRelease,
	recordRollback,
	setApplicationId,
	setBackupState,
	setPostgresBackupId,
} from '../../deploy/state.js';
import type { AppDeployResult, DeployResult } from '../../deploy/types';
import { workerDockerfileOf } from '../../docker/index.js';
import { WORKER_PORT } from '../../docker/templates.js';
import { plannedSeeds } from '../../migrate/databases';
import { output } from '../../output';
import { verifyStageProviders } from '../../providers/index.js';
import {
	assertStageProvidersEnabled,
	stageProviderNotes,
} from '../../providers/notes.js';
import { workerEnvKeys } from '../../reconcile/apps.js';
import { constructGlobs } from '../../reconcile/workspace.js';
import type { RunOptions } from '../../run';
import { assertStageCredentials } from '../../secrets/credentialSchemas.js';
import { assertNoStaleSecrets } from '../../secrets/stale.js';
import { initStageSecrets } from '../../secrets/storage.js';
import type { StageSecrets } from '../../secrets/types.js';
import {
	otlpTelemetryEnv,
	resolveStageTelemetry,
} from '../../telemetry/config.js';
import {
	appTelemetry,
	scopeTelemetryEnv,
	telemetryOf,
	usesTelemetry,
} from '../../telemetry/edges.js';
import { derivedApps } from '../../workspace/derive.js';
import { getAppBuildOrder, getPublicEnvPrefix } from '../../workspace/index.js';
import type {
	DokployVerifyConfig,
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../../workspace/types.js';
import { reportDatabaseRuns, reportPlannedSeeds } from '../seeds';
import type {
	DeployFailure,
	DeployPhaseContext,
	DeploySecrets,
	TargetEvent,
} from '../types';
import { provisionDeclared } from './declared';
import { orchestrateDns, verifyDnsRecords } from './dns/index.js';
import {
	DEFAULT_DEPLOYMENT_TIMEOUT_MS,
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
import type { DokployCluster } from './fromManifest';
import { verifyHealth } from './health';
import { migrationUrls, runMigrations } from './migrations';
import {
	applyDeclaredStatements,
	type PublishedPostgres,
	publishedUrl,
	publishPostgres,
	serverHostname,
} from './postgres';

export { PostgresNotReady, PostgresPortUnavailable } from './postgres';

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

/**
 * What the Dokploy engine is handed by its target: where its events go,
 * where it gets credentials, and whether it may change anything.
 */
interface DokployContext {
	emit: (event: TargetEvent) => void;
	credentials: CredentialProvider;
	signal: AbortSignal;
	/** Look everything up, create, build and push nothing. */
	dryRun: boolean;
	/** Where docker's own output goes. Defaults to the terminal. */
	stdio?: RunOptions['stdio'];
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

/**
 * Sites failed to release or to answer. Every site is attempted before this
 * is thrown, so one broken site does not keep the others back — but the run
 * fails, and what failed is rolled back.
 */
export class FrontendDeployFailed extends Error {
	constructor(
		readonly apps: readonly string[],
		cause: unknown,
	) {
		super(
			`Frontend deployment failed for ${apps.join(', ')}: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
		this.name = 'FrontendDeployFailed';
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

/** How `resolveProject` found a project, in the journal's words. */
const PROJECT_VIA: Record<ResolvedProject['via'], ResourceVia> = {
	state: 'recorded',
	marker: 'found',
	created: 'created',
};

/** `childOutput` as `spawn` reads it, where it is not the default. */
const CHILD_STDIO: Record<'stderr' | 'ignore', RunOptions['stdio']> = {
	stderr: ['ignore', 2, 2],
	ignore: 'ignore',
};

/**
 * A Dokploy deploy in progress: what `validate` found, and what each later
 * phase adds for the next.
 */
export interface DokployRun {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	stage: string;
	imageTag: string;
	appsToDeployNames: string[];
	identity: DeployIdentity;
	store: StateStore;
	skipped: readonly { app: string; reason: string }[];
	secrets: DeploySecrets;
	ctx: DokployContext;
	preflight: Preflight;
	/** How each release is waited for and checked. */
	verify: VerifySettings;
	/** Roll back every app the run released, not only the failed ones. */
	atomic: boolean;
	/**
	 * The dev services the run uses for mail and buckets the stage does not
	 * account for — what `--allow-dev-services` came to.
	 */
	devServices: readonly DevService[];
	/**
	 * The Workers this run deploys — each with background work whose host app
	 * is being deployed — as applications of their own, with no domain.
	 */
	workers: readonly WorkerUnit[];
	/** Each owner's runnables' edges, from discovery: what a worker reads. */
	runnables: Readonly<Record<string, readonly string[]>>;
	provisioned?: Provisioned;
	released?: Released;
	/** What the run changed live, for `rollback` to undo. */
	releasing: Releasing;
	/**
	 * Clusters published for the migrations, by database: opened by
	 * `provision` for the role DDL, closed by `release` once they have run.
	 */
	published: Map<string, PublishedPostgres>;
	result?: DeployResult;
}

/** `deploy.dokploy.verify`, with its defaults. */
export type VerifySettings = Required<DokployVerifyConfig>;

/** The defaults of `deploy.dokploy.verify`. */
export function verifySettings(
	config: DokployVerifyConfig | undefined,
): VerifySettings {
	return {
		deploymentTimeoutMs:
			config?.deploymentTimeoutMs ?? DEFAULT_DEPLOYMENT_TIMEOUT_MS,
		healthCheckPath: config?.healthCheckPath ?? '/health',
		healthyAfter: config?.healthyAfter ?? 3,
		intervalMs: config?.intervalMs ?? 2_000,
		healthTimeoutMs: config?.healthTimeoutMs ?? 5 * 60_000,
	};
}

/** What a run has changed live, app by app. */
interface Releasing {
	/**
	 * Each app whose Dokploy application was pointed at a new image, with what
	 * ran before — undefined for an app that had never been released.
	 */
	switched: Map<string, { applicationId: string; before?: DeployedImage }>;
	/** The apps that failed to release or to answer. */
	failed: Set<string>;
}

/**
 * Deploy every app in a workspace to Dokploy: the engine under the built-in
 * `dokploy` target.
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
 * The run around it — the target, the apps, the lock, the phase events — is
 * `runDeploy`'s. This says what it is doing and checks what Dokploy needs.
 *
 * @internal
 */
export async function validateDokploy(
	phase: DeployPhaseContext<unknown>,
): Promise<DokployRun> {
	const { workspace, stage, identity, tag: imageTag } = phase;
	const ctx: DokployContext = {
		emit: phase.emit,
		credentials: phase.credentials,
		signal: phase.signal,
		dryRun: phase.dryRun,
		...(phase.childOutput !== 'inherit'
			? { stdio: CHILD_STDIO[phase.childOutput] }
			: {}),
	};

	logger.log(`\n🚀 Deploying workspace "${workspace.name}" to Dokploy...`);
	logger.log(`   Stage: ${stage}`);
	logger.log(`   Tag: ${imageTag}`);

	// Every app asked for, in build order, including those another target
	// deploys: the line says what was asked, the skips below what was not done.
	const askedFor = new Set([
		...phase.apps,
		...phase.skipped.map((skipped) => skipped.app),
	]);
	const asked = getAppBuildOrder(workspace).filter((name) =>
		askedFor.has(name),
	);
	logger.log(
		asked.length === Object.keys(workspace.apps).length
			? `   Deploying all apps: ${asked.join(', ')}`
			: `   Deploying apps: ${asked.join(', ')}`,
	);
	for (const { app, reason } of phase.skipped) {
		logger.log(`   ⚠️  Skipping ${app}: ${reason}`);
	}

	// Mobile apps deploy via their own toolchain (e.g. EAS Build for Expo).
	// They stay in the list, for the line that says they were skipped.
	const appsToDeployNames = [...phase.apps];
	for (const name of appsToDeployNames) {
		if (workspace.apps[name]!.type === 'mobile') {
			phase.skip(name, MOBILE_SKIP_REASON);
		}
	}

	const run = {
		workspace,
		manifest: phase.manifest,
		stage,
		imageTag,
		appsToDeployNames,
		identity,
		store: phase.state,
		skipped: phase.skipped,
		secrets: phase.secrets,
		ctx,
	};

	// Mail and storage before anything else is read or written: a deployed
	// stage's are its own, from its secrets, unless a dev service is allowed
	// to stand in — and one missing any key stops here, naming every one.
	const stored = await phase.secrets.read();
	// A kind the stage set to `false` is refused before its keys are.
	assertStageProvidersEnabled(workspace, phase.manifest, stage);
	const services = assertExternalServices({
		stage,
		declarations: manifestServiceDeclarations(phase.manifest),
		supplied: stored?.custom ?? {},
		allow: phase.allowDevServices,
		...(workspace.domains?.[stage] ? { domain: workspace.domains[stage] } : {}),
		providers: stageProviderNotes(workspace, stage),
	});
	const devServices = devServicesUsed(services);
	reportDevServices(phase, devServices);

	// What the stage's providers created is still there, and the stage's key
	// reaches it — `deploy.objects`' bucket, answering its own key.
	const verified = await verifyStageProviders({
		workspace,
		manifest: phase.manifest,
		stage,
		secrets: stored?.custom ?? {},
	});
	for (const line of verified) logger.log(`   ✓ ${line} verified`);

	// An address an older gkm stored for what a construct now provides: a
	// `localhost` URL is never where a deployed app finds anything.
	assertNoStaleSecrets({
		manifest: phase.manifest,
		stage,
		supplied: stored?.custom ?? {},
	});

	// A third party's credentials against their construct's schema, before
	// anything is built with one every app reading it would refuse.
	await assertStageCredentials({
		root: workspace.root,
		patterns: constructGlobs(workspace),
		manifest: phase.manifest,
		stage,
		supplied: stored?.custom ?? {},
	});

	// Which workers run, and what each reads: the runnables' edges and where
	// each worker's work is declared, from the run's own discovery.
	const runnables = phase.runnables ?? {};
	const background = phase.background ?? {};
	const workers = workerUnits(workspace, phase.manifest, background).filter(
		(worker) => appsToDeployNames.includes(worker.app),
	);
	if (workers.length > 0) {
		logger.log(
			`   Deploying workers: ${workers.map((w) => `${w.name} (from ${w.app})`).join(', ')}`,
		);
	}

	return {
		...run,
		devServices: devServices.map((use) => use.service),
		workers,
		runnables,
		preflight: await preflight(run),
		verify: verifySettings(workspace.deploy.dokploy?.verify),
		atomic: phase.atomic,
		releasing: { switched: new Map(), failed: new Set() },
		published: new Map(),
	};
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
	secrets: secretsStore,
	ctx,
}: Pick<
	DokployRun,
	'workspace' | 'manifest' | 'stage' | 'secrets' | 'ctx'
>): Promise<Preflight> {
	logger.log('\n🔐 Loading secrets and analyzing environment requirements...');

	// The stage's own store — SSM or Secrets Manager in its account, for a stage kept there —
	// read through the run, which masks every value from here on.
	const stored = await secretsStore.read();
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
				`   🔑 Would generate for "${stage}" (${secretsStore.store}): ${generated.join(', ')}`,
			);
		} else {
			await secretsStore.write(stageSecrets);
			logger.log(
				`   🔑 Generated for "${stage}" (${secretsStore.store}): ${generated.join(', ')}`,
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

/** What `provision` leaves for `release` and `verify`. */
interface Provisioned {
	api: DokployApi;
	endpoint: string;
	journal: DeployJournal;
	state: DeployJournal['state'];
	projectId: string;
	environmentId: string;
	registry: string | undefined;
	registryId: string;
	declaredEnv: Record<string, string>;
	/** Each declared cluster, by the database it serves. */
	declaredClusters: Record<string, DokployCluster>;
	/** The URLs `release` migrates with, by database; none when nothing is pending. */
	migrations: Map<string, Record<string, string>>;
	changes: ResourceChange[];
	applied: Applied;
}

/** What `release` leaves for `verify` and the result. */
interface Released {
	results: AppDeployResult[];
	publicUrls: Record<string, string>;
	appHostnames: Map<string, string>;
	/** The apps whose domain exists, and so can be checked by name. */
	appDomainIds: Map<string, string>;
	applicationIds: Map<string, string>;
}

/**
 * The project, environment and registry, then what the manifest declares.
 * Each is looked up — by the id the stage's state recorded, else by name —
 * before it is created, so a run stopped part way is finished by the next.
 */
export async function provisionDokploy(run: DokployRun): Promise<void> {
	try {
		await provision(run);
	} catch (error) {
		// A cluster kept published for the migrations is closed here when the
		// run never reaches them.
		await closePublished(run);
		throw error;
	}
}

/** Unpublish every cluster the run still has published. */
async function closePublished(run: DokployRun): Promise<void> {
	for (const published of run.published.values()) await published.close();
	run.published.clear();
}

async function provision(run: DokployRun): Promise<void> {
	const {
		workspace,
		manifest,
		stage,
		appsToDeployNames,
		identity,
		store,
		ctx,
	} = run;
	const { stageSecrets } = run.preflight;

	const changes: ResourceChange[] = [];
	const applied: Applied = (change, via) => {
		changes.push(change);
		ctx.emit({ type: 'resource.applied', ...change, via });
	};

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
	const registry = workspace.deploy.registry;
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
	// What `release` migrates, by the database its cluster serves.
	let migrations = new Map<string, Record<string, string>>();

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
			devServices: run.devServices,
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
		//
		// A cluster whose migrations `release` will apply stays published until
		// they have run: publishing restarts the container, and doing it twice
		// per deploy is two restarts of a database apps are serving from.
		migrations = await migrationUrls(workspace.root, manifest, declaredEnv);
		const host = serverHostname(endpoint);

		for (const [databaseName, cluster] of Object.entries(declared.clusters)) {
			const statements = declared.statements.filter(
				(statement) => statement.database === databaseName,
			);
			if (statements.length === 0) continue;

			const published = await publishPostgres(api, cluster, host);
			run.published.set(databaseName, published);
			const created = await applyDeclaredStatements(published, statements);
			if (!migrations.has(databaseName)) {
				await published.close();
				run.published.delete(databaseName);
			}

			logger.log(
				`   🗄️  ${databaseName}: applied ${statements.length} statement(s), ${created} new`,
			);
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

	run.provisioned = {
		api,
		endpoint,
		journal,
		state,
		projectId: project.projectId,
		environmentId,
		registry,
		registryId,
		declaredEnv,
		declaredClusters,
		migrations,
		changes,
		applied,
	};
}

/**
 * The stage's migrations, then each app's image built and pushed, its
 * application configured and deployed, and its domain attached — counted as
 * released only once Dokploy's deployment has finished.
 *
 * Backends first, each failure stopping the run; then they are checked, and
 * a backend that does not answer stops the run too — a site built against an
 * API that is down is a site that is down. Then the sites, whose build args
 * are the backends' public URLs: every one is attempted, and any that failed
 * fails the run. `verify` checks the sites.
 *
 * Building is here rather than in a `build` phase of its own because an
 * image is built beside its application — a site's build args are resolved
 * per app, against the backends released before it.
 */
export async function releaseDokploy(run: DokployRun): Promise<void> {
	const { workspace, stage, imageTag, appsToDeployNames, identity, ctx } = run;
	const { stageSecrets, sniffedApps, encryptedSecrets } = run.preflight;
	const {
		api,
		journal,
		state,
		environmentId,
		registry,
		registryId,
		declaredEnv,
		changes,
		applied,
	} = run.provisioned!;
	const project = { projectId: run.provisioned!.projectId };

	// Where the stage's telemetry goes. Dokploy runs no collector of its own,
	// so a stage that uses a `Telemetry` node names one (`otlp`) or opts out —
	// checked when the deploy was validated.
	const telemetry = resolveStageTelemetry({
		...(workspace.deploy?.telemetry
			? { telemetry: workspace.deploy.telemetry }
			: {}),
		stage,
		local: false,
		target: 'dokploy',
		runtime: 'server',
		selfHosted: false,
		used: usesTelemetry(run.manifest),
	});
	const telemetryValues =
		telemetry?.provider === 'otlp' ? otlpTelemetryEnv(telemetry) : undefined;

	// ==================================================================
	// MIGRATIONS: before any app is pointed at code that expects them
	// ==================================================================
	try {
		await migrate(run);
	} finally {
		await closePublished(run);
	}

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
	const released: Released = {
		results,
		publicUrls,
		appHostnames,
		appDomainIds,
		applicationIds: new Map(),
	};
	run.released = released;

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

	/** An image is pushed: worth keeping even if what follows fails. */
	const built = (
		appName: string,
		image: { imageRef?: string; digest?: string },
		ref: string,
	) => {
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

	/**
	 * Point an app's application at its image and environment, deploy it,
	 * attach its domain, and wait for Dokploy to finish — then record the
	 * release, with what ran before it as the one a rollback restores.
	 */
	const release = async (
		appName: string,
		applicationId: string,
		image: DeployedImage,
		envVars: string[],
		/** Where it answers — none for a worker, which has no route. */
		host: string | undefined,
	): Promise<void> => {
		released.applicationIds.set(appName, applicationId);

		// Dokploy's clock, read before deploying: the deployment to wait for is
		// the first one after it.
		const since = await api.latestDeploymentAt(applicationId);
		const before = state.releases?.[appName]?.current;
		run.releasing.switched.set(appName, {
			applicationId,
			...(before ? { before } : {}),
		});

		// Configure and deploy application in Dokploy
		await api.saveDockerProvider(applicationId, image.ref, { registryId });
		await api.saveApplicationEnv(applicationId, envVars.join('\n'));

		logger.log(`      Deploying to Dokploy...`);
		await api.deployApplication(applicationId);

		if (host) {
			const domainId = await ensureDomain(
				api,
				journal,
				host,
				workspace.apps[appName]!.port,
				applicationId,
				applied,
			);
			appHostnames.set(appName, host);
			if (domainId) appDomainIds.set(appName, domainId);
		}

		logger.log(`      Waiting for the deployment to finish...`);
		await api.waitForDeployment(applicationId, {
			since,
			timeoutMs: run.verify.deploymentTimeoutMs,
			intervalMs: run.verify.intervalMs,
			signal: ctx.signal,
		});
		recordRelease(state, appName, { ...image, tag: imageTag });
		await journal.save();
		if (host) publicUrls[appName] = `https://${host}`;
	};

	// ==================================================================
	// PRE-COMPUTE: Frontend URLs for BETTER_AUTH_TRUSTED_ORIGINS
	// ==================================================================
	const frontendUrls: string[] = [];
	for (const appName of frontendApps) {
		frontendUrls.push(`https://${hostOf(workspace, appName, stage)}`);
	}

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
				built(appName, image, imageRef);

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
				//
				// The stage's telemetry goes to a backend with an edge to the
				// `Telemetry` node, named for it, and to no other. A site never
				// gets it — its environment ends up in a browser bundle.
				const withDeclared = scopeTelemetryEnv(
					{ ...resolved, ...declaredEnv },
					{
						uses: appTelemetry(run.manifest, appName) !== undefined,
						serviceName: appName,
						...(telemetryValues ? { telemetry: telemetryValues } : {}),
					},
				);

				// Build env vars string for Dokploy
				const envVars: string[] = Object.entries(withDeclared).map(
					([key, value]) => `${key}=${value}`,
				);

				if (Object.keys(withDeclared).length > 0) {
					logger.log(
						`      Resolved ${Object.keys(withDeclared).length} env vars: ${Object.keys(withDeclared).sort().join(', ')}`,
					);
				}

				await release(
					appName,
					application.applicationId,
					{
						ref: image.imageRef ?? imageRef,
						...(image.digest ? { digest: image.digest } : {}),
					},
					envVars,
					backendHost,
				);

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
				failed(run, appName, error);

				// Abort on backend failure to prevent incomplete deployment
				throw new BackendDeployFailed(appName, error);
			}
		}

		// Every backend answering before any site is released against it.
		await settleDns(run, backendApps);
		for (const appName of backendApps) {
			try {
				await checkHealth(run, appName);
			} catch (error) {
				if (ctx.signal?.aborted) throw ctx.signal.reason;
				failed(run, appName, error);
				throw new BackendDeployFailed(appName, error);
			}
		}
	}

	// ==================================================================
	// PHASE 1b: Deploy workers — an application each, with no domain
	// ==================================================================
	if (run.workers.length > 0) {
		logger.log('\n🧵 Deploying workers...');

		for (const worker of run.workers) {
			ctx.signal?.throwIfAborted();
			logger.log(`\n   🧵 Deploying ${worker.name} (worker ${worker.id})...`);

			try {
				const application = await ensureApplication(
					api,
					journal,
					worker.name,
					applicationName(identity, worker.name),
					project.projectId,
					environmentId,
					applied,
				);

				// Exactly what its constructs read: the stage's secrets among
				// them embedded, encrypted, as a backend's are; the declared
				// URLs among them as its environment.
				const keys = [
					...(workerEnvKeys(run.manifest, worker.id, run.runnables) ?? []),
				].sort();
				const secrets = prepareSecretsForApp(stageSecrets, {
					appName: worker.name,
					requiredEnvVars: keys,
					optionalEnvVars: [],
				});
				const credentials =
					secrets.secretCount > 0
						? {
								encrypted: secrets.payload.encrypted,
								iv: secrets.payload.iv,
							}
						: undefined;

				const imageRef = imageRefFor(identity, worker.name, registry, imageTag);
				logger.log(`      Building Docker image: ${imageRef}`);
				const image = await deployDocker({
					stage,
					tag: imageTag,
					skipPush: false,
					config: {
						registry,
						imageName: imageName(identity, worker.name),
						appName: worker.name,
					},
					credentials,
					cwd: workspace.root,
					dockerfile: workerDockerfileOf(worker.name),
					...(ctx.signal ? { signal: ctx.signal } : {}),
					...(ctx.stdio ? { stdio: ctx.stdio } : {}),
				});
				built(worker.name, image, imageRef);

				const env: Record<string, string> = {
					...scopeTelemetryEnv(
						Object.fromEntries(
							Object.entries(declaredEnv).filter(([key]) => keys.includes(key)),
						),
						{
							uses: telemetryOf(run.manifest, worker.id) !== undefined,
							serviceName: worker.name,
							...(telemetryValues ? { telemetry: telemetryValues } : {}),
						},
					),
					...(credentials ? { GKM_MASTER_KEY: secrets.masterKey } : {}),
					NODE_ENV: 'production',
					PORT: String(WORKER_PORT),
					STAGE: stage,
				};
				logger.log(
					`      Resolved ${Object.keys(env).length} env vars: ${Object.keys(env).sort().join(', ')}`,
				);

				await release(
					worker.name,
					application.applicationId,
					{
						ref: image.imageRef ?? imageRef,
						...(image.digest ? { digest: image.digest } : {}),
					},
					Object.entries(env).map(([key, value]) => `${key}=${value}`),
					undefined,
				);
				// No domain: Dokploy's finished deployment — the container up,
				// past its own HEALTHCHECK — is its check.
				await checkHealth(run, worker.name);

				results.push({
					appName: worker.name,
					type: 'backend',
					success: true,
					applicationId: application.applicationId,
					imageRef,
					...(image.digest ? { digest: image.digest } : {}),
				});
				logger.log(`      ✓ ${worker.name} deployed successfully`);
			} catch (error) {
				if (ctx.signal?.aborted) throw ctx.signal.reason;
				failed(run, worker.name, error);
				throw new BackendDeployFailed(worker.name, error);
			}
		}
	}

	// ==================================================================
	// PHASE 2: Deploy frontend apps (with public URLs from backends)
	// ==================================================================
	let frontendFailure: unknown;
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
				built(appName, image, imageRef);

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

				await release(
					appName,
					application.applicationId,
					{
						ref: image.imageRef ?? imageRef,
						...(image.digest ? { digest: image.digest } : {}),
					},
					envVars,
					frontendHost,
				);

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
				failed(run, appName, error);
				// Every site is attempted — one broken site does not hold the
				// others back — but the run fails once they have been.
				frontendFailure ??= error;
			}
		}
	}

	// ==================================================================
	// STATE: Save deploy state
	// ==================================================================
	logger.log('\n📋 Saving deploy state...');
	await journal.save();
	logger.log('   ✓ State saved');

	if (frontendFailure !== undefined) {
		throw new FrontendDeployFailed(
			frontendApps.filter((app) => run.releasing.failed.has(app)),
			frontendFailure,
		);
	}
}

/** Each released site answering, after its DNS. Backends were checked in `release`. */
export async function verifyDokploy(run: DokployRun): Promise<void> {
	const { workspace, ctx } = run;
	const sites = run
		.released!.results.filter((result) => result.success)
		.map((result) => result.appName)
		.filter((app) => workspace.apps[app]?.type === 'web');
	if (sites.length === 0) return;

	await settleDns(run, sites);

	let failure: unknown;
	for (const appName of sites) {
		try {
			await checkHealth(run, appName);
		} catch (error) {
			if (ctx.signal.aborted) throw ctx.signal.reason;
			failed(run, appName, error);
			failure ??= error;
		}
	}
	if (failure !== undefined) {
		throw new FrontendDeployFailed(
			sites.filter((app) => run.releasing.failed.has(app)),
			failure,
		);
	}
}

/**
 * An app failed to release or to answer: say so, mark it for rollback, and
 * record it in the result — over the success it was recorded as, if its
 * health is what failed.
 */
function failed(run: DokployRun, appName: string, error: unknown): void {
	// A worker is no app of the workspace's, and runs on a server: a backend.
	const type = run.workspace.apps[appName]?.type ?? 'backend';
	const message = error instanceof Error ? error.message : 'Unknown error';
	logger.log(`      ✗ Failed to deploy ${appName}: ${message}`);

	const results = run.released!.results;
	const recorded = results.find((result) => result.appName === appName);
	if (recorded) {
		recorded.success = false;
		recorded.error = message;
	} else {
		results.push({ appName, type, success: false, error: message });
	}
	run.releasing.failed.add(appName);
	run.ctx.emit({ type: 'app.failed', app: appName, error: eventError(error) });
}

/**
 * The stage's pending migrations applied, then every seed run, in the
 * deploy's sandbox against each cluster published for them. Nothing is
 * published, and nothing runs, for a project with neither.
 */
async function migrate(run: DokployRun): Promise<void> {
	const { workspace, manifest, stage, ctx } = run;
	const { api, endpoint, migrations, declaredClusters } = run.provisioned!;
	if (migrations.size === 0) return;

	logger.log('\n🗄️  Applying migrations and seeds...');
	const host = serverHostname(endpoint);
	const urls: Record<string, string> = {};
	for (const [database, keys] of migrations) {
		const cluster = declaredClusters[database];
		if (!cluster) continue;

		let published = run.published.get(database);
		if (!published) {
			published = await publishPostgres(api, cluster, host);
			run.published.set(database, published);
		}
		for (const [key, url] of Object.entries(keys)) {
			urls[key] = publishedUrl(url, published);
		}
	}

	const ran = await runMigrations({
		root: workspace.root,
		stage,
		manifest,
		patterns: constructGlobs(workspace),
		urls,
		signal: ctx.signal,
	});
	for (const { migrations: folder, applied } of ran.migrations) {
		if (applied.length === 0) logger.log(`   ✓ ${folder}: up to date`);
	}
	reportDatabaseRuns(
		ran.migrations.map(({ construct, migrations: folder, applied }) => ({
			construct,
			folder,
			applied,
		})),
		ran.seeds.map(({ construct, seeds: folder, seeded }) => ({
			construct,
			folder,
			seeded,
		})),
		(line) => logger.log(`   ${line}`),
		(event) => ctx.emit(event),
	);
}

/**
 * DNS records for `apps`' hosts, their propagation, and Dokploy's validation
 * of each domain — before anything is asked of them by name.
 */
async function settleDns(
	run: DokployRun,
	apps: readonly string[],
): Promise<void> {
	const { workspace } = run;
	const { api, endpoint, journal, state } = run.provisioned!;
	const appHostnames = new Map(
		[...run.released!.appHostnames].filter(([app]) => apps.includes(app)),
	);
	// ==================================================================
	// DNS: Create DNS records, verify propagation, and validate for SSL
	// ==================================================================
	const dnsConfig = workspace.dns;
	if (!dnsConfig || appHostnames.size === 0) return;

	const dnsResult = await orchestrateDns(appHostnames, dnsConfig, endpoint);

	// Verify DNS records resolve correctly (with state caching)
	if (dnsResult?.serverIp) {
		await verifyDnsRecords(appHostnames, dnsResult.serverIp, state);

		// Save state again to persist DNS verification results
		await journal.save();
	}

	// Validate domains to trigger SSL certificate generation
	if (dnsResult?.success) {
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

/**
 * Whether a released app answers: `healthyAfter` 2xx in a row from its
 * health route under its domain. An app without a domain has nothing to ask
 * by name, so Dokploy's finished deployment is its check.
 */
async function checkHealth(run: DokployRun, appName: string): Promise<void> {
	const { workspace, verify, ctx } = run;
	const { appHostnames, appDomainIds, applicationIds } = run.released!;
	const host = appHostnames.get(appName);

	if (!host || !appDomainIds.has(appName)) {
		ctx.emit({
			type: 'health.checked',
			app: appName,
			url: `dokploy:application.status/${applicationIds.get(appName)}`,
			healthy: true,
			attempt: 1,
		});
		logger.log(
			`   ✓ ${appName}: no domain, so its finished deployment is its check`,
		);
		return;
	}

	const path =
		workspace.apps[appName]!.type === 'web' ? '/' : verify.healthCheckPath;
	const url = `https://${host}${path}`;
	logger.log(`\n🩺 Checking ${appName} at ${url}...`);
	await verifyHealth({
		app: appName,
		url,
		healthyAfter: verify.healthyAfter,
		intervalMs: verify.intervalMs,
		timeoutMs: verify.healthTimeoutMs,
		signal: ctx.signal,
		emit: ctx.emit,
	});
	logger.log(`   ✓ ${appName} healthy (${verify.healthyAfter} in a row)`);
}

/**
 * Point an application back at `image`, deploy it, and wait for Dokploy to
 * finish. The environment stays the newer release's: it is resolved from the
 * stage, which a rollback does not change, and holds no image of its own.
 */
export async function restoreImage(
	api: DokployApi,
	options: {
		applicationId: string;
		image: DeployedImage;
		registryId: string | undefined;
		verify: VerifySettings;
		signal: AbortSignal;
	},
): Promise<void> {
	const { applicationId, image, registryId, verify, signal } = options;
	const since = await api.latestDeploymentAt(applicationId);
	await api.saveDockerProvider(
		applicationId,
		image.ref,
		registryId ? { registryId } : undefined,
	);
	await api.deployApplication(applicationId);
	await api.waitForDeployment(applicationId, {
		since,
		timeoutMs: verify.deploymentTimeoutMs,
		intervalMs: verify.intervalMs,
		signal,
	});
}

/**
 * Put back what ran before this run, after its `release` or `verify` failed:
 * the apps that failed — or, `atomic`, every app the run released — each
 * pointed at its previous image and redeployed. An app released for the
 * first time has nothing to go back to and is left as it is.
 */
export async function rollbackDokploy(
	run: DokployRun,
	failure: DeployFailure,
): Promise<void> {
	const { switched, failed: failedApps } = run.releasing;
	const apps = [...switched.keys()].filter(
		(app) => run.atomic || failedApps.has(app),
	);
	if (!run.provisioned || apps.length === 0) {
		logger.log(
			`\n⏪ Nothing to roll back: the ${failure.phase} failed before any app was switched.`,
		);
		return;
	}

	const { api, journal, state, registryId } = run.provisioned;
	logger.log(
		`\n⏪ Rolling back ${run.atomic ? 'every app this run released' : 'what failed'}: ${apps.join(', ')}`,
	);

	for (const appName of apps) {
		const { applicationId, before } = switched.get(appName)!;
		if (!before) {
			logger.log(
				`   ⚠ ${appName}: this was its first release, so there is nothing to restore`,
			);
			continue;
		}

		await restoreImage(api, {
			applicationId,
			image: before,
			registryId,
			verify: run.verify,
			signal: run.ctx.signal,
		});
		recordRollback(state, appName, before);
		await journal.save();
		logger.log(`   ✓ ${appName} rolled back to ${before.ref}`);
	}
}

/** What the run did, printed as the summary it always ended with. */
export function dokployResult(run: DokployRun): DeployResult {
	if (run.result) return run.result;

	const { stage, identity, imageTag } = run;
	const { projectId, environmentId, changes } = run.provisioned!;
	const { results, publicUrls } = run.released!;
	const project = { projectId };

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
		skipped: [...run.skipped],
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

/**
 * Where docker runs for one app: the workspace root, building from the
 * Dockerfile `gkm docker` writes for the app there.
 */
function dockerRun(
	workspace: NormalizedWorkspace,
	app: NormalizedAppConfig,
	ctx: DokployContext,
): {
	cwd: string;
	appPath: string;
	signal?: AbortSignal;
	stdio?: RunOptions['stdio'];
} {
	return {
		// The workspace's root, never the process's: a deploy started anywhere
		// — or by a host whose working directory is its own — builds the
		// same image.
		cwd: workspace.root,
		appPath: app.path,
		...(ctx.signal ? { signal: ctx.signal } : {}),
		...(ctx.stdio ? { stdio: ctx.stdio } : {}),
	};
}

/** The Dokploy login, from the run's provider, or `MissingCredential`. */
export async function dokployApi(
	workspace: NormalizedWorkspace,
	ctx: Pick<DokployContext, 'credentials' | 'signal'>,
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
		workspace.domains,
		app.type === 'web' && isMainFrontendApp(appName, app, workspace.apps),
	);
}

/**
 * What a deploy would do, from the same lookups it starts with — and nothing
 * else: no lock, no state written, no secret generated, no Dokploy resource
 * created or changed, no image built or pushed.
 */
export async function planDokploy(run: DokployRun): Promise<void> {
	const { workspace, manifest, stage, imageTag, appsToDeployNames, identity } =
		run;
	const { ctx } = run;
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
		registry: workspace.deploy.registry,
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

	// Every seed runs on every deploy, so what a release would run is what
	// the folders hold, whatever the database does.
	reportPlannedSeeds(
		(await plannedSeeds({ root: workspace.root, manifest })).map(
			({ target, seeds }) => ({ folder: target.seeds, seeds }),
		),
		(line) => logger.log(`   ${line}`),
	);

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
			workspace.deploy.registry,
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

	for (const worker of run.workers) {
		const dokployAppName = applicationName(identity, worker.name);
		const recordedId = state?.applications?.[worker.name];
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
						key: `application:${worker.name}`,
						resourceType: 'application',
						action: 'reuse',
						id: existing.applicationId,
					}
				: {
						key: `application:${worker.name}`,
						resourceType: 'application',
						action: 'create',
					},
			`${dokployAppName}, worker ${worker.id} — no domain`,
		);
		const ref = imageRefFor(
			identity,
			worker.name,
			workspace.deploy.registry,
			imageTag,
		);
		plan(
			{ key: `image:${worker.name}`, resourceType: 'image', action: 'build' },
			ref,
		);
		apps.push({
			appName: worker.name,
			type: 'backend',
			success: true,
			imageRef: ref,
			...(existing ? { applicationId: existing.applicationId } : {}),
		});
	}

	const creates = changes.filter((c) => c.action !== 'reuse').length;
	logger.log(
		`\n✅ Dry run complete: ${creates} to create or build, ${changes.length - creates} to reuse.`,
	);

	run.result = {
		apps,
		projectId: project?.projectId ?? '',
		environmentId: environment?.environmentId ?? '',
		successCount: apps.length,
		failedCount: 0,
		stage,
		identity: identity.key,
		tag: imageTag,
		dryRun: true,
		skipped: [...run.skipped],
		urls,
		changes,
	};
}

/** Why a mobile app is left out of a Dokploy deploy. */
const MOBILE_SKIP_REASON = 'deploys via its framework toolchain';
