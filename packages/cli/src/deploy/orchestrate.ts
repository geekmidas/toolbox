/**
 * The run around a target: what every deploy does whatever it deploys
 * through.
 *
 * It loads the workspace, resolves the target, works out the apps and the
 * identity, takes the stage's lock, and calls the target's phases in order,
 * reporting each as it starts, finishes or fails. Everything that is about
 * *where* the stage goes is the target's.
 */

import { dnsCredentials, stageDnsDomains } from '../compose/dns.js';
import { GkmError } from '../errors';
import { provisionStage } from '../providers/index.js';
import { discover } from '../reconcile/discover.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { initStageSecrets } from '../secrets/storage.js';
import { builtinTarget } from '../target/builtins';
import {
	parseTargetOptions,
	type ResolvedTarget,
	resolveTarget,
} from '../target/resolve';
import { deploySecrets, Redactor } from '../target/secrets';
import type {
	AnyDeployTarget,
	DeployPhaseContext,
	DeployTargetLogger,
} from '../target/types';
import { resolveStageTelemetry } from '../telemetry/config';
import { usesTelemetry } from '../telemetry/edges';
import { derivedApps } from '../workspace/derive.js';
import { getAppBuildOrder } from '../workspace/index.js';
import { assertDeployedStage } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import type { CredentialProvider } from './credentials';
import { DevServicesNeedServerTarget } from './devServices';
import { type DeployEvent, type DeployPhase, eventError } from './events';
import { applicationName, deployIdentity } from './identity.js';
import { assertStageReady } from './readiness';
import {
	assertStateOutlivesRun,
	assertStateRoom,
	createStateStore,
} from './StateStore.js';
import type { DeployResult } from './types';

/** What a run deploys, once the workspace is loaded. */
export interface DeployRequest {
	/** Deployment stage (e.g., 'production', 'staging') */
	stage: string;
	/** Image tag (default: stage-timestamp) */
	tag?: string;
	/** Specific apps to deploy (default: all) */
	apps?: string[];
	/** The target to deploy through. Defaults to `deploy.default`. */
	target?: string;
	/** On a failed release, roll back every app rather than the failed ones. */
	atomic?: boolean;
	/**
	 * `--allow-dev-services`: a deployed stage runs the dev service for every
	 * bucket and mail it does not account for. Server targets only.
	 */
	allowDevServices?: boolean;
	/** `--skip-dns`: a server target writes and checks no host's DNS. */
	skipDns?: boolean;
	/** `--rotate-keys`: each provider issues its runtime keys a successor. */
	rotateKeys?: boolean;
	/** `--retire-old-keys`: delete a rotated-out key now. */
	retireOldKeys?: boolean;
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
	/**
	 * Validate and build — the target's images built, and pushed where it
	 * pushes them — and nothing else: no lock, nothing provisioned, released,
	 * verified or recorded. What a CI job runs before a server pulls.
	 */
	buildOnly?: boolean;
	/** The CLI's home, for the stage's keys. Defaults to `GKM_HOME`. */
	home?: string;
	/** Where spawned processes' output goes. Defaults to the terminal. */
	childOutput?: 'inherit' | 'stderr' | 'ignore';
	/** The host's own targets, which win over every other by the same name. */
	targets?: Record<string, AnyDeployTarget>;
	/**
	 * What the run masks in what it prints. `deploy()` passes the one its
	 * progress lines go through; a run without one masks only its events.
	 */
	redactor?: Redactor;
}

/** Apps were asked for by name that the workspace does not have. */
export class UnknownDeployApps extends GkmError {
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

/** Every app asked for deploys through some other target. */
export class NoDeployableApps extends GkmError {
	constructor(
		readonly stage: string,
		readonly target: string,
	) {
		super(
			`No apps to deploy through "${target}": every selected app deploys somewhere else. Pick the target with --target, or set each app's deploy in gkm.config.ts.`,
		);
		this.name = 'NoDeployableApps';
	}
}

/** A build-only run through a target with no build phase. */
export class TargetBuildsNothing extends GkmError {
	constructor(readonly target: string) {
		super(
			`"${target}" has no build phase, so a build-only run would do nothing. Deploy it in full, or build through a target that builds images (compose).`,
		);
		this.name = 'TargetBuildsNothing';
	}
}

/** A failed rollback, after the failure that called for it. */
export class RollbackFailed extends Error {
	constructor(
		readonly target: string,
		/** What failed first, and was being rolled back. */
		readonly failure: unknown,
		cause: unknown,
	) {
		super(
			`Deploying through "${target}" failed, and so did rolling it back: ${cause instanceof Error ? cause.message : String(cause)}. The stage may be part-released; deploy again, or roll it back by hand. The first failure: ${failure instanceof Error ? failure.message : String(failure)}`,
			{ cause },
		);
		this.name = 'RollbackFailed';
	}
}

/**
 * Generate image tag from stage and timestamp
 */
export function generateTag(stage: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	return `${stage}-${timestamp}`;
}

/** Why an app that deploys through another target is left out. */
function elsewhere(target: string, stage: string): string {
	const instead = builtinTarget(target)?.instead?.(stage);
	if (instead) return `it deploys through "${target}" — ${instead}`;
	return `it deploys through "${target}" — run \`gkm deploy --target ${target} --stage ${stage}\``;
}

/**
 * Deploy a workspace's stage through its target.
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
	const { stage } = request;
	const redactor = ctx.redactor ?? new Redactor();
	const emit = (event: DeployEvent) =>
		ctx.emit(
			event.type === 'log'
				? { ...event, message: redactor.redact(event.message) }
				: event,
		);

	/** Run one phase between its events. */
	const phase = async <T>(name: DeployPhase, body: () => Promise<T>) => {
		ctx.signal?.throwIfAborted();
		emit({ type: 'phase.started', phase: name });
		try {
			const value = await body();
			emit({ type: 'phase.finished', phase: name });
			return value;
		} catch (error) {
			emit({ type: 'phase.failed', phase: name, error: eventError(error) });
			throw error;
		}
	};

	ctx.signal?.throwIfAborted();
	emit({ type: 'phase.started', phase: 'validate' });

	let prepared: Prepared;
	try {
		prepared = await prepare(source, request, ctx, emit, redactor);
	} catch (error) {
		emit({ type: 'phase.failed', phase: 'validate', error: eventError(error) });
		throw error;
	}
	const { resolved, phaseCtx, store } = prepared;
	const { target } = resolved;

	// The stage's resources — what its providers create, and the keys they
	// write into its secrets — before any check reads those secrets, so a key
	// the deploy creates is never reported missing. A build-only run creates
	// nothing, and neither does the local stage.
	const resources =
		!ctx.buildOnly && phaseCtx.stage !== phaseCtx.workspace.stages.local;
	const provision = async () => {
		// The token the stage's DNS records are written with, asked for first:
		// a deploy without it fails before anything is created or started.
		if (!request.skipDns && resolved.target.runtime === 'server') {
			try {
				await dnsCredentials(
					phaseCtx.stage,
					stageDnsDomains(
						phaseCtx.stage,
						phaseCtx.workspace.domains,
						phaseCtx.workspace.dns,
					),
					ctx.credentials,
				);
			} catch (error) {
				emit({
					type: 'phase.failed',
					phase: 'validate',
					error: eventError(error),
				});
				throw error;
			}
		}
		await provisionResources(phaseCtx, request, ctx, store, emit);
	};

	// A dry run takes no lock: it writes nothing a lock would protect, and it
	// should not stop a real deploy that starts while it is looking.
	if (ctx.dryRun) {
		if (resources) await provision();
		const run = await validate(phaseCtx, emit, () =>
			readyToDeploy(target, phaseCtx),
		);
		await phase('plan', () => target.plan(phaseCtx, run));
		return target.result(phaseCtx, run);
	}

	// Building changes no stage — nothing is provisioned, released or
	// recorded — so it takes no lock: a CI job building the next release must
	// not fail because a server is deploying the last one. Nor is the stage
	// asked whether it is ready to be deployed: an image carries none of its
	// keys, and a key the deploy writes is not there until the deploy runs.
	if (ctx.buildOnly) {
		if (!target.build) throw new TargetBuildsNothing(resolved.name);
		const run = await validate(phaseCtx, emit, () => target.validate(phaseCtx));
		await phase('build', () => target.build!(phaseCtx, run));
		return target.result(phaseCtx, run);
	}

	// One deploy of a stage at a time. Taken before the target generates,
	// provisions or records anything, and held until the run ends however it
	// ends. A second run of the stage — another CI job, a laptop — gets
	// `StateLocked` naming this one instead of racing it; a run killed with
	// the lock held is released with `gkm state:unlock`.
	let lock: Awaited<ReturnType<typeof store.lock>>;
	try {
		// A CI runner's disk is gone when the job ends; state kept on it is
		// lost with it, and the next run recreates every resource.
		assertStateOutlivesRun(phaseCtx.workspace, stage, 'deploy');
		lock = await store.lock(stage, { operation: 'deploy' });
	} catch (error) {
		emit({ type: 'phase.failed', phase: 'validate', error: eventError(error) });
		throw error;
	}

	try {
		// The state this run will write fits where it is kept — checked before
		// anything is created or started, not found out at the last write,
		// with the stack already running and nowhere to record it.
		try {
			await assertStateRoom(store, stage);
		} catch (error) {
			emit({
				type: 'phase.failed',
				phase: 'validate',
				error: eventError(error),
			});
			throw error;
		}
		if (resources) await provision();
		const run = await validate(phaseCtx, emit, () =>
			readyToDeploy(target, phaseCtx),
		);
		if (target.provision) {
			await phase('provision', () => target.provision!(phaseCtx, run));
		}
		if (target.build) {
			await phase('build', () => target.build!(phaseCtx, run));
		}

		let releasing: 'release' | 'verify' = 'release';
		try {
			await phase('release', () => target.release(phaseCtx, run));
			releasing = 'verify';
			if (target.verify) {
				await phase('verify', () => target.verify!(phaseCtx, run));
			}
		} catch (error) {
			// The caller stopping the run is not a release to undo.
			if (ctx.signal?.aborted || !target.capabilities.rollback) throw error;
			if (!target.rollback) throw error;
			try {
				await phase('rollback', () =>
					target.rollback!(phaseCtx, run, { phase: releasing, error }),
				);
			} catch (rollbackError) {
				throw new RollbackFailed(resolved.name, error, rollbackError);
			}
			throw error;
		}

		return await target.result(phaseCtx, run);
	} finally {
		await lock.release();
	}
}

/**
 * The stage's providers, run inside the validate phase. A dry run plans them
 * and, so the checks after it see the stage as the run would leave it, reads
 * the keys they would write as placeholders.
 */
async function provisionResources(
	phaseCtx: DeployPhaseContext<unknown>,
	request: DeployRequest,
	ctx: DeployContext,
	store: Awaited<ReturnType<typeof createStateStore>>,
	emit: (event: DeployEvent) => void,
): Promise<void> {
	try {
		const reports = await provisionStage({
			workspace: phaseCtx.workspace,
			stage: phaseCtx.stage,
			manifest: phaseCtx.manifest,
			runnables: (phaseCtx.runnables ?? {}) as Record<string, string[]>,
			secrets: phaseCtx.secrets,
			state: store,
			dryRun: ctx.dryRun,
			...(request.rotateKeys ? { rotateKeys: true } : {}),
			...(request.retireOldKeys ? { retireOldKeys: true } : {}),
			...(ctx.home ? { home: ctx.home } : {}),
			log: (line) => phaseCtx.logger.info(line),
		});
		if (!ctx.dryRun) return;
		const planned = reports.flatMap((r) => r.planned);
		if (planned.length === 0) return;
		const secrets = phaseCtx.secrets;
		(phaseCtx as { secrets: typeof secrets }).secrets = {
			...secrets,
			async read() {
				const stored =
					(await secrets.read()) ?? initStageSecrets(phaseCtx.stage);
				const custom = { ...stored.custom };
				for (const key of planned) custom[key] ??= PLANNED_BY_THE_DEPLOY;
				return { ...stored, custom };
			},
		};
	} catch (error) {
		emit({ type: 'phase.failed', phase: 'validate', error: eventError(error) });
		throw error;
	}
}

/** What a dry run reads for a key its providers would write. */
export const PLANNED_BY_THE_DEPLOY = 's3://planned-by-this-deploy';

/**
 * What a deploy validates: the stage ready to be deployed — every key it
 * needs, read as its providers left them — then what the target would run,
 * then whatever only the target checks. A build-only run validates the
 * target's run alone: it calls neither readiness check.
 */
async function readyToDeploy(
	target: AnyDeployTarget,
	phaseCtx: DeployPhaseContext<unknown>,
): Promise<unknown> {
	// The rules are a stack's, built from the stage's secrets: a target that
	// runs none — AWS — has its stage's keys from its own tool.
	if (target.runtime === 'server') await assertStageReady(phaseCtx);
	const run = await target.validate(phaseCtx);
	await target.ready?.(phaseCtx, run);
	return run;
}

/** `body`, then the run's `deploy.started`, inside the validate phase. */
async function validate(
	phaseCtx: DeployPhaseContext<unknown>,
	emit: (event: DeployEvent) => void,
	body: () => Promise<unknown>,
): Promise<unknown> {
	try {
		const run = await body();
		const skipped = new Set(phaseCtx.skipped.map((s) => s.app));
		emit({
			type: 'deploy.started',
			stage: phaseCtx.stage,
			target: phaseCtx.target,
			identity: phaseCtx.identity.key,
			tag: phaseCtx.tag,
			apps: phaseCtx.apps.filter((app) => !skipped.has(app)),
			dryRun: phaseCtx.dryRun,
		});
		emit({ type: 'phase.finished', phase: 'validate' });
		return run;
	} catch (error) {
		emit({ type: 'phase.failed', phase: 'validate', error: eventError(error) });
		throw error;
	}
}

interface Prepared {
	resolved: ResolvedTarget;
	phaseCtx: DeployPhaseContext<unknown>;
	store: Awaited<ReturnType<typeof createStateStore>>;
}

/** Everything the phases are handed, worked out before the first of them. */
async function prepare(
	source: NormalizedWorkspace | (() => Promise<NormalizedWorkspace>),
	request: DeployRequest,
	ctx: DeployContext,
	emit: (event: DeployEvent) => void,
	redactor: Redactor,
): Promise<Prepared> {
	const { stage } = request;
	const configured = typeof source === 'function' ? await source() : source;

	// Before anything is provisioned: a typo'd stage would otherwise create a
	// whole second environment under the wrong name. The local stage is left
	// to the target, which says whether it can run it.
	const local = stage === configured.stages.local;
	if (!local) assertDeployedStage(configured.stages, stage);

	// Before anything is discovered or derived: a target that cannot be found
	// — or a package that would not load — fails a deploy that has done
	// nothing yet.
	const targetName = request.target ?? configured.deploy?.default ?? 'dokploy';
	const resolved = await resolveTarget(targetName, {
		workspace: configured,
		stage,
		...(ctx.targets ? { host: ctx.targets } : {}),
	});
	if (local && !resolved.target.capabilities.localStage) {
		assertDeployedStage(configured.stages, stage);
	}
	const options = await parseTargetOptions(resolved);

	// Before anything is discovered: dev services asked of a target that runs
	// no containers fail a deploy that has done nothing.
	const allowDevServices = request.allowDevServices === true;
	if (allowDevServices && resolved.target.runtime === 'aws') {
		throw new DevServicesNeedServerTarget(targetName);
	}

	// What to deploy comes from the manifest.
	//
	// Discovered here rather than by the target, because the list of things
	// to deploy is the *declarations* — one `rest-api` is one server, one
	// `site` is one site — and the config only says how to run each. A project
	// that declares no surfaces keeps its configured apps, so adopting
	// constructs stays something you do a piece at a time.
	const runnables: Record<string, string[]> = {};
	const background: Record<string, string[]> = {};
	const manifest = await discover({
		patterns: constructGlobs(configured),
		cwd: configured.root,
		runnables,
		background,
	});
	// Where the stage's telemetry goes, settled before anything is built: a
	// stage that uses a `Telemetry` node on a target that cannot choose for it
	// — AWS has no self-hosted provider — fails here, naming the config.
	resolveStageTelemetry({
		...(configured.deploy?.telemetry
			? { telemetry: configured.deploy.telemetry }
			: {}),
		stage,
		local,
		target: targetName,
		runtime: resolved.target.runtime,
		selfHosted: resolved.target.capabilities.selfHostedTelemetry === true,
		used: usesTelemetry(manifest),
	});

	const units = derivedApps(manifest, configured);
	const workspace: NormalizedWorkspace =
		Object.keys(units).length > 0 ? { ...configured, apps: units } : configured;

	// What every resource this deploy touches is named and claimed by —
	// resolved first, so a namespace that cannot be a name fails before
	// anything is built.
	const identity = deployIdentity(workspace, stage);
	const tag =
		request.tag ??
		(resolved.target.tag
			? await resolved.target.tag({ cwd: workspace.root, stage })
			: generateTag(stage));

	// The apps asked for, in dependency order.
	const buildOrder = getAppBuildOrder(workspace);
	let selected = buildOrder;
	if (request.apps && request.apps.length > 0) {
		const unknown = request.apps.filter((name) => !workspace.apps[name]);
		if (unknown.length > 0) {
			throw new UnknownDeployApps(unknown, Object.keys(workspace.apps));
		}
		selected = buildOrder.filter((name) => request.apps!.includes(name));
	}

	const skipped: { app: string; reason: string }[] = [];
	const skip = (app: string, reason: string) => {
		skipped.push({ app, reason });
		emit({ type: 'app.skipped', app, reason });
	};

	// An app that names another target deploys there, in a run of its own.
	// One on the default follows the run, so `--target` moves the stage
	// without every app having to be told.
	const byDefault = configured.deploy?.default ?? 'dokploy';
	const apps = selected.filter((name) => {
		const own = workspace.apps[name]!.resolvedDeployTarget;
		const deploysThrough = own === byDefault ? targetName : own;
		if (deploysThrough === targetName) return true;
		skip(name, elsewhere(deploysThrough, stage));
		return false;
	});
	if (apps.length === 0) throw new NoDeployableApps(stage, targetName);

	// The local stage's state is this machine's, always: it runs nothing
	// remote, so it never reads or writes the deployed stages' store — nor
	// needs that store's credentials.
	const store = await createStateStore({
		config: stage === workspace.stages.local ? undefined : workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
		namespace: workspace.deploy?.namespace,
	});
	const secrets = await deploySecrets(workspace, stage, redactor, {
		...(ctx.home ? { home: ctx.home } : {}),
	});

	const line =
		(level: 'info' | 'warn' | 'error') =>
		(message: string): void =>
			emit({ type: 'log', level, message });
	const logger: DeployTargetLogger = {
		info: line('info'),
		warn: line('warn'),
		error: line('error'),
	};

	const phaseCtx: DeployPhaseContext<unknown> = {
		target: targetName,
		cwd: workspace.root,
		stage,
		tag,
		tagGiven: request.tag !== undefined,
		apps,
		skipped,
		identity,
		workspace,
		manifest,
		runnables,
		background,
		options,
		dryRun: ctx.dryRun,
		atomic: request.atomic ?? false,
		allowDevServices,
		...(request.skipDns ? { skipDns: true } : {}),
		credentials: ctx.credentials,
		state: store,
		secrets,
		logger,
		signal: ctx.signal ?? new AbortController().signal,
		childOutput: ctx.childOutput ?? 'inherit',
		emit,
		skip,
		name: (resource) => applicationName(identity, resource),
	};

	return { resolved, phaseCtx, store };
}
