/**
 * Running providers on a stage: `ensure()` at the start of every deploy —
 * before its checks, so a key the deploy creates is never reported missing —
 * `verify()` from every deploy's checks, and the hint a stage missing a key
 * is given.
 *
 * See `types.ts` for what a provider is.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import { stageBackups } from '../backups/config.js';
import {
	ensureStageBackups,
	verifyStageBackups,
} from '../backups/provision.js';
import { BACKUPS_URL_KEY } from '../backups/service.js';
import { deployIdentity } from '../deploy/identity.js';
import { DeployJournal } from '../deploy/journal.js';
import type { ResourceRecord, StateStore } from '../deploy/StateStore.js';
import { createComposeState, createEmptyState } from '../deploy/state.js';
import { GkmError } from '../errors';
import { initStageSecrets } from '../secrets/storage.js';
import type { StageSecrets } from '../secrets/types.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { stageProvider } from './config.js';
import { deploysWithCompose } from './dns.js';
import { builtinProvider } from './registry.js';
import {
	PROVIDER_KINDS,
	type ProviderKind,
	type ProvisionAction,
	type ProvisionState,
	type ResourceProvider,
} from './types.js';

export {
	checkStageProvider,
	stageProvider,
	UnknownStageProvider,
} from './config.js';
export {
	assertStageProvidersEnabled,
	provisionCommand,
	provisionHint,
	StageProviderDisabled,
	stageProviderNotes,
} from './notes.js';
export { BUILTIN_PROVIDERS, builtinProvider } from './registry.js';
export type * from './types.js';

/** The constructs of a kind: `objects` is every bucket. */
function constructsOf(manifest: ConstructManifest, kind: ProviderKind) {
	return Object.entries(manifest)
		.filter(([, d]) => d.kind === kind)
		.map(([id]) => id)
		.sort();
}

export interface VerifyStageInput {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	stage: string;
	/** The stage's secrets, by key. */
	secrets: Readonly<Record<string, string>>;
	/** What the stage's state records, by key. */
	resources?: Readonly<Record<string, ResourceRecord>>;
	/** Progress worth printing. */
	log?: (line: string) => void;
}

/**
 * What every deploy runs: each provider's `verify()` — the cheap check that
 * what it created is still there and the stage's key reaches it. Nothing on
 * the local stage, and nothing for a kind on `external` or `false` — a kind
 * the stage has none of is the deploy's readiness check's to refuse.
 */
export async function verifyStageProviders(
	input: VerifyStageInput,
): Promise<string[]> {
	const verified: string[] = [];
	for (const kind of PROVIDER_KINDS) {
		if (constructsOf(input.manifest, kind).length === 0) continue;
		const choice = stageProvider(input.workspace, kind, input.stage);
		if (choice.mode !== 'provider') continue;
		const provider = builtinProvider(kind, choice.name)!;
		await provider.verify({
			workspace: input.workspace,
			manifest: input.manifest,
			stage: input.stage,
			config: choice.config,
			secrets: input.secrets,
			...(input.resources ? { resources: input.resources } : {}),
			...(input.log ? { log: input.log } : {}),
		});
		verified.push(`${kind}: ${provider.name}`);
	}
	if (await verifyStageBackups(input)) verified.push('backups: s3');
	return verified;
}

/** The stage's secrets, as the deploy reads and writes them. */
export interface ProvisionSecrets {
	read(): Promise<StageSecrets | null>;
	write(secrets: StageSecrets): Promise<void>;
}

export interface ProvisionOptions {
	workspace: NormalizedWorkspace;
	stage: string;
	manifest: ConstructManifest;
	runnables?: Record<string, string[]>;
	/** The stage's secrets — where each runtime key is written. */
	secrets: ProvisionSecrets;
	/** The stage's deploy state. The caller holds the stage's lock. */
	state: StateStore;
	/** Print the plan; write nothing to the account, the state or the secrets. */
	dryRun?: boolean;
	/** Issue each runtime key a successor. */
	rotateKeys?: boolean;
	/** Delete a rotated-out key now rather than after the next deploy. */
	retireOldKeys?: boolean;
	/** The AWS profile for the stage's account. */
	profile?: string;
	/** The CLI's home. */
	home?: string;
	env?: NodeJS.ProcessEnv;
	log?: (line: string) => void;
}

/** What one kind came to on a provisioning run. */
export interface KindReport {
	/** A provider kind, or the stage's backups. */
	kind: ProviderKind | 'backups';
	mode: 'external' | 'none' | 'provider';
	provider?: string;
	actions: ProvisionAction[];
	/**
	 * The runtime keys the stage's secrets do not hold yet, which the run
	 * writes — or, on a dry run, would.
	 */
	planned: string[];
}

/**
 * A stage whose provider creates its resources, and no credentials to create
 * them with. Raised before anything is created, built or started.
 */
export class ProviderCredentialsMissing extends GkmError {
	constructor(
		readonly stage: string,
		readonly kind: ProviderKind,
		readonly provider: string,
		/** The constructs it would have created resources for. */
		readonly ids: readonly string[],
		/** The environment variables it reads. */
		readonly env: readonly string[],
		/** How to supply them, in one line. */
		readonly describe: string,
		/** A `gkm login --provider` name, where it has one. */
		readonly login?: string,
	) {
		super(
			`deploy.${kind}.${stage} is ${provider}, so the deploy creates what ` +
				`${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} backed by on ` +
				`'${stage}' and writes ${ids.length === 1 ? 'its key' : 'their keys'} ` +
				`into the stage's secrets — and it found no ${provider} credentials ` +
				`to do it with. On this machine, supply ${describe}` +
				(login ? `, or run gkm login --provider ${login}` : '') +
				'. In CI, the step that runs the deploy needs them: the ' +
				`'${stage}' environment's role ` +
				'(AWS_ROLE_ARN, from gkm deploy:github), assumed before that step. ' +
				`With the keys set by hand instead, set deploy.${kind}.${stage} to 'external'.`,
		);
		this.name = 'ProviderCredentialsMissing';
	}
}

/**
 * `ensure()` for every provider the stage configures — find or create, fix
 * drift, record in the stage's state, write the runtime keys into its
 * secrets. Run by the deploy, which holds the stage's lock. A provider with
 * no provisioning credentials stops the run with
 * {@link ProviderCredentialsMissing} before anything is created.
 */
export async function provisionStage(
	options: ProvisionOptions,
): Promise<KindReport[]> {
	const { workspace, stage, manifest } = options;
	const dryRun = options.dryRun === true;
	const env = options.env ?? process.env;
	const log = options.log ?? ((line: string) => console.log(line));
	const runnables = options.runnables ?? {};

	const reports: KindReport[] = [];
	const configured: {
		kind: ProviderKind;
		provider: ResourceProvider<any, any>;
		config: unknown;
		credential: unknown;
		report: KindReport;
	}[] = [];

	for (const kind of PROVIDER_KINDS) {
		const choice = stageProvider(workspace, kind, stage);
		if (choice.mode !== 'provider') {
			reports.push({ kind, mode: choice.mode, actions: [], planned: [] });
			continue;
		}
		const provider = builtinProvider(kind, choice.name)!;
		const report: KindReport = {
			kind,
			mode: 'provider',
			provider: provider.name,
			actions: [],
			planned: [],
		};
		reports.push(report);
		const ids = constructsOf(manifest, kind);
		if (ids.length === 0) continue;

		const credential = await provider.credentials({
			stage,
			env,
			...(options.profile ? { profile: options.profile } : {}),
			...(options.home ? { home: options.home } : {}),
		});
		if (credential === undefined) {
			throw new ProviderCredentialsMissing(
				stage,
				kind,
				provider.name,
				ids,
				provider.provisioning.env,
				provider.provisioning.describe,
				provider.provisioning.login,
			);
		}
		configured.push({
			kind,
			provider,
			config: choice.config,
			credential,
			report,
		});
	}

	// The stage's backups: whether there are any is the stack's to say, and
	// a stage with none needs nothing of this run.
	const backups = stageBackups(workspace, manifest, stage);
	if (configured.length === 0 && backups.mode !== 'on') {
		if (backups.mode === 'disabled') {
			log(
				`💾 backups: off — deploy.backups.${stage} is false. Nothing is backed up, and nothing already backed up is deleted.`,
			);
		}
		return reports;
	}

	const identity = deployIdentity(workspace, stage);
	let secrets = (await options.secrets.read())?.custom ?? {};
	for (const entry of configured) {
		entry.report.planned = entry.provider
			.runtimeKeys(manifest)
			.filter((key) => secrets[key] === undefined);
	}

	const state: ProvisionState = dryRun
		? await readOnlyState(options.state, stage)
		: journalState(
				await DeployJournal.open(options.state, stage, () =>
					deploysWithCompose(workspace)
						? createComposeState(stage)
						: createEmptyState(stage, '', ''),
				),
			);

	const writeSecrets = async (values: Record<string, string>) => {
		if (dryRun) return;
		const stored = (await options.secrets.read()) ?? initStageSecrets(stage);
		const next = {
			...stored,
			custom: { ...stored.custom, ...values },
			updatedAt: new Date().toISOString(),
		};
		await options.secrets.write(next);
		secrets = next.custom;
	};

	for (const entry of configured) {
		log(
			`☁️  ${entry.kind}: ${entry.provider.name}${dryRun ? ' (dry run)' : ''}`,
		);
		await entry.provider.ensure({
			workspace,
			manifest,
			runnables,
			stage,
			identity,
			config: entry.config,
			credential: entry.credential,
			get secrets() {
				return secrets;
			},
			state,
			dryRun,
			rotateKeys: options.rotateKeys === true,
			retireOldKeys: options.retireOldKeys === true,
			async change(action, apply) {
				if (!dryRun) await apply();
				entry.report.actions.push(action);
				log(
					`   ${dryRun ? 'would ' : ''}${action.change} — ${action.resource}`,
				);
			},
			writeSecrets,
			log,
		});
		if (entry.report.actions.length === 0) {
			log('   up to date');
		}
	}

	if (backups.mode === 'on' || backups.mode === 'disabled') {
		const report: KindReport = {
			kind: 'backups',
			mode: backups.mode === 'on' ? 'provider' : 'none',
			actions: [],
			planned:
				backups.mode === 'on' && secrets[BACKUPS_URL_KEY] === undefined
					? [BACKUPS_URL_KEY]
					: [],
		};
		reports.push(report);
		await ensureStageBackups({
			workspace,
			manifest,
			stage,
			...(options.profile ? { profile: options.profile } : {}),
			...(options.home ? { home: options.home } : {}),
			env,
			ctx: {
				identity,
				stage,
				state,
				dryRun,
				get secrets() {
					return secrets;
				},
				rotateKeys: options.rotateKeys === true,
				retireOldKeys: options.retireOldKeys === true,
				async change(action, apply) {
					if (!dryRun) await apply();
					report.actions.push(action);
					log(
						`   ${dryRun ? 'would ' : ''}${action.change} — ${action.resource}`,
					);
				},
				writeSecrets,
				log,
			},
		});
		if (backups.mode === 'on' && report.actions.length === 0) {
			log('   up to date');
		}
	}

	return reports;
}

/** The journal as `ensure()` sees it. */
function journalState(journal: DeployJournal): ProvisionState {
	return {
		record: (key) => journal.record(key),
		pending: (entry) => journal.pending(entry),
		ready: (entry, id) => journal.ready(entry, id),
		lastDeployedAt: journal.existed ? journal.state.lastDeployedAt : undefined,
	};
}

/** What a dry run reads, and the writes it does not make. */
async function readOnlyState(
	store: StateStore,
	stage: string,
): Promise<ProvisionState> {
	const stored = await store.read(stage);
	return {
		record: (key) => stored?.resources[key],
		pending: async () => {},
		ready: async () => {},
		...(stored ? { lastDeployedAt: stored.state.lastDeployedAt } : {}),
	};
}
