/**
 * Provisioning: a stage's providers, on their own.
 *
 * What each provider creates — buckets, mail identities, store access, Maps
 * keys — and the keys it writes into the stage's secrets. `gkm deploy` runs
 * it first, then builds and releases; `gkm provision` runs it and stops. One
 * step, so the two cannot drift.
 *
 * The local stage is a stage like any other here: a kind with no local
 * stand-in (`LOCAL_PROVIDER_RULES`) that `deploy.<kind>.<local>` names is
 * provisioned for it. The rest are external locally — MinIO and Mailpit
 * serve them.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import {
	type KindReport,
	provisionStage,
	verifyStageProviders,
} from '../providers/index.js';
import { type BoundSubscriber, discover } from '../reconcile/discover.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { moveBucketKeys } from '../secrets/bucketKeys.js';
import { initStageSecrets } from '../secrets/storage.js';
import { deploySecrets, Redactor } from '../target/secrets';
import type { DeployTargetLogger } from '../target/types';
import { derivedApps } from '../workspace/derive.js';
import { assertDeployedStage } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { type DeployEvent, type DeployPhase, eventError } from './events';
import type { DeployContext } from './orchestrate';
import {
	assertStateOutlivesRun,
	assertStateRoom,
	createStateStore,
	type StateStore,
} from './StateStore.js';

/** What a dry run reads for a key its providers would write. */
export const PLANNED_BY_THE_DEPLOY = 's3://planned-by-this-deploy';

/** The stage's secrets, as a run reads and writes them. */
type RunSecrets = Awaited<ReturnType<typeof deploySecrets>>;

/** What provisioning reads of a run, and the two things it sets on it. */
export interface ProvisionTarget {
	workspace: NormalizedWorkspace;
	stage: string;
	manifest: ConstructManifest;
	subscribers?: Readonly<Record<string, readonly BoundSubscriber[]>>;
	/** Replaced, on a dry run, by a view with the keys it would write. */
	secrets: RunSecrets;
	logger: DeployTargetLogger;
	/** The DNS records the providers asked for, for the target to keep. */
	providerDns?: readonly string[];
}

/** The flags a provisioning run takes. */
export interface ProvisionFlags {
	/** `--rotate-keys`: each provider issues its runtime keys a successor. */
	rotateKeys?: boolean;
	/** `--retire-old-keys`: delete a rotated-out key now. */
	retireOldKeys?: boolean;
	/** `--project`: the Google Cloud project for the stage's Google providers. */
	project?: string;
}

/**
 * The stage's providers: its stored bucket keys moved to the names they are
 * read from, then every provider's `ensure()`. A dry run plans them and, so
 * what reads the stage after it sees it as the run would leave it, reads the
 * keys they would write as placeholders.
 */
export async function provisionResources(
	target: ProvisionTarget,
	flags: ProvisionFlags,
	ctx: Pick<DeployContext, 'dryRun' | 'home' | 'profile' | 'credentials'>,
	store: StateStore,
): Promise<KindReport[]> {
	// The local stage's bucket keys are MinIO's, under the names it was
	// always given: nothing to move.
	if (target.stage !== target.workspace.stages.local) {
		await moveStoredBucketKeys(target, ctx.dryRun);
	}
	const reports = await provisionStage({
		workspace: target.workspace,
		stage: target.stage,
		manifest: target.manifest,
		...(target.subscribers ? { subscribers: target.subscribers } : {}),
		secrets: target.secrets,
		state: store,
		dryRun: ctx.dryRun,
		...(flags.rotateKeys ? { rotateKeys: true } : {}),
		...(flags.retireOldKeys ? { retireOldKeys: true } : {}),
		...(flags.project ? { project: flags.project } : {}),
		...(ctx.home ? { home: ctx.home } : {}),
		...(ctx.profile ? { profile: ctx.profile } : {}),
		credentials: ctx.credentials,
		log: (line) => target.logger.info(line),
	});
	target.providerDns = reports.flatMap((r) => r.dns);
	if (!ctx.dryRun) return reports;
	const planned = reports.flatMap((r) => r.planned);
	if (planned.length === 0) return reports;
	const secrets = target.secrets;
	target.secrets = {
		...secrets,
		async read() {
			const stored = (await secrets.read()) ?? initStageSecrets(target.stage);
			const custom = { ...stored.custom };
			for (const key of planned) custom[key] ??= PLANNED_BY_THE_DEPLOY;
			return { ...stored, custom };
		},
	};
	return reports;
}

/**
 * The stage's bucket and file-server keys moved to the names they are read
 * from (`moveBucketKeys`), before its providers or its readiness check read
 * them. A dry run moves them in what it reads, and writes nothing.
 */
async function moveStoredBucketKeys(
	target: ProvisionTarget,
	dryRun: boolean,
): Promise<void> {
	const secrets = target.secrets;
	const stored = await secrets.read();
	if (!stored) return;
	const { custom, moved } = moveBucketKeys(target.manifest, stored.custom);
	if (moved.length === 0) return;

	for (const { from, to } of moved) {
		target.logger.info(
			`🔑 ${from} → ${to}${dryRun ? ' (dry run: not written)' : ''}`,
		);
	}
	if (!dryRun) {
		await secrets.write({
			...stored,
			custom,
			updatedAt: new Date().toISOString(),
		});
		return;
	}
	target.secrets = {
		...secrets,
		async read() {
			const current = await secrets.read();
			return current
				? {
						...current,
						custom: moveBucketKeys(target.manifest, current.custom).custom,
					}
				: current;
		},
	};
}

/** What `gkm provision` asks for. */
export interface ProvisionRequest extends ProvisionFlags {
	stage: string;
}

/** What a provisioning run came to. */
export interface ProvisionResult {
	stage: string;
	dryRun: boolean;
	/** Each kind's provider, what it changed and the keys it wrote. */
	reports: KindReport[];
	/** Each provider whose `verify()` passed afterwards. */
	verified: string[];
}

/** A provisioning run's events: a deploy's phases and lines, and its end. */
export type ProvisionEvent =
	| Extract<
			DeployEvent,
			{ type: 'phase.started' | 'phase.finished' | 'phase.failed' | 'log' }
	  >
	| { type: 'provision.finished'; result: ProvisionResult }
	| { type: 'provision.failed'; error: ReturnType<typeof eventError> };

/**
 * Provision a stage: its providers' `ensure()`, then their `verify()` — the
 * deploy's first step, with nothing built or released. Holds the stage's
 * lock, as a deploy does; a dry run takes none and writes nothing.
 *
 * @internal The engine under `gkm provision`.
 */
export async function runProvision(
	source: NormalizedWorkspace | (() => Promise<NormalizedWorkspace>),
	request: ProvisionRequest,
	ctx: Omit<DeployContext, 'emit'> & {
		emit: (event: ProvisionEvent) => void;
	},
): Promise<ProvisionResult> {
	const { stage } = request;
	const redactor = ctx.redactor ?? new Redactor();
	const emit = (event: ProvisionEvent) =>
		ctx.emit(
			event.type === 'log'
				? { ...event, message: redactor.redact(event.message) }
				: event,
		);
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

	const prepared = await phase('validate', async () => {
		const configured = typeof source === 'function' ? await source() : source;
		// The local stage is provisioned too — only what has no local stand-in.
		if (stage !== configured.stages.local) {
			assertDeployedStage(configured.stages, stage);
		}
		const subscribers: Record<string, BoundSubscriber[]> = {};
		const manifest = await discover({
			patterns: constructGlobs(configured),
			cwd: configured.root,
			subscribers,
		});
		const units = derivedApps(manifest, configured);
		const workspace: NormalizedWorkspace =
			Object.keys(units).length > 0
				? { ...configured, apps: units }
				: configured;
		// The local stage's state is this machine's, as a deploy's is.
		const store = await createStateStore({
			config: stage === workspace.stages.local ? undefined : workspace.state,
			workspaceRoot: workspace.root,
			workspaceName: workspace.name,
			namespace: workspace.deploy?.namespace,
			...(ctx.profile ? { profile: ctx.profile } : {}),
		});
		const secrets = await deploySecrets(workspace, stage, redactor, {
			...(ctx.home ? { home: ctx.home } : {}),
			...(ctx.profile ? { profile: ctx.profile } : {}),
		});
		const line =
			(level: 'info' | 'warn' | 'error') =>
			(message: string): void =>
				emit({ type: 'log', level, message });
		const target: ProvisionTarget = {
			workspace,
			stage,
			manifest,
			subscribers,
			secrets,
			logger: { info: line('info'), warn: line('warn'), error: line('error') },
		};
		// A dry run takes no lock: it writes nothing a lock would protect.
		if (ctx.dryRun) return { target, store, lock: undefined };
		assertStateOutlivesRun(workspace, stage, 'provision');
		// The state the run writes fits where it is kept: checked before the
		// lock, so a stage with no room is refused without holding it.
		await assertStateRoom(store, stage);
		const lock = await store.lock(stage, { operation: 'provision' });
		return { target, store, lock };
	});
	const { target, store, lock } = prepared;

	const run = async (): Promise<ProvisionResult> => {
		const reports = await phase('provision', () =>
			provisionResources(target, request, ctx, store),
		);
		const verified = ctx.dryRun
			? []
			: await phase('verify', async () => {
					const lines = await verifyStageProviders({
						workspace: target.workspace,
						manifest: target.manifest,
						stage,
						secrets: (await target.secrets.read())?.custom ?? {},
						resources: (await store.read(stage))?.resources ?? {},
						log: (message) => target.logger.info(message),
					});
					for (const verifiedLine of lines) {
						target.logger.info(`✓ ${verifiedLine} verified`);
					}
					return lines;
				});
		return { stage, dryRun: ctx.dryRun, reports, verified };
	};

	try {
		return await run();
	} finally {
		await lock?.release();
	}
}
