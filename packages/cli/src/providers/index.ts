/**
 * Running providers on a stage: `ensure()` from `gkm setup --stage <stage>`,
 * `verify()` from every deploy, and the hint a stage missing a key is given.
 *
 * See `types.ts` for what a provider is.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import { deployIdentity } from '../deploy/identity.js';
import { DeployJournal } from '../deploy/journal.js';
import { createStateStore } from '../deploy/StateStore.js';
import { createComposeState, createEmptyState } from '../deploy/state.js';
import { discover } from '../reconcile/discover.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { initStageSecrets } from '../secrets/storage.js';
import { secretsStoreFor } from '../secrets/store.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { stageProvider } from './config.js';
import { deploysWithCompose } from './dns.js';
import { assertStageProvidersEnabled, provisionCommand } from './notes.js';
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
}

/**
 * What every deploy runs: each provider's `verify()` — the cheap check that
 * what it created is still there and the stage's key reaches it. Nothing on
 * the local stage, and nothing for a kind on `external`.
 *
 * @throws {StageProviderDisabled} for a declared kind the stage has none of
 */
export async function verifyStageProviders(
	input: VerifyStageInput,
): Promise<string[]> {
	assertStageProvidersEnabled(input.workspace, input.manifest, input.stage);
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
		});
		verified.push(`${kind}: ${provider.name}`);
	}
	return verified;
}

export interface ProvisionOptions {
	workspace: NormalizedWorkspace;
	stage: string;
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
	/** The manifest, when the caller discovered it already. */
	manifest?: ConstructManifest;
	runnables?: Record<string, string[]>;
}

/** What one kind came to on a provisioning run. */
export interface KindReport {
	kind: ProviderKind;
	mode: 'external' | 'none' | 'provider';
	provider?: string;
	/** Whether the provider found provisioning credentials. */
	credentials?: boolean;
	actions: ProvisionAction[];
}

/**
 * `ensure()` for every provider the stage configures — find or create, fix
 * drift, record in the stage's state, write the runtime keys into its
 * secrets. A provider without provisioning credentials leaves the stage as
 * `external` and says how to supply them.
 */
export async function provisionStage(
	options: ProvisionOptions,
): Promise<KindReport[]> {
	const { workspace, stage } = options;
	const dryRun = options.dryRun === true;
	const env = options.env ?? process.env;
	const log = options.log ?? ((line: string) => console.log(line));

	const named = PROVIDER_KINDS.some(
		(kind) => stageProvider(workspace, kind, stage).mode === 'provider',
	);
	let found = options.manifest;
	let runnables = options.runnables ?? {};
	if (!found && named) {
		runnables = {};
		found = await discover({
			patterns: constructGlobs(workspace),
			cwd: workspace.root,
			runnables,
		});
	}

	const manifest: ConstructManifest = found ?? {};
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
			reports.push({ kind, mode: choice.mode, actions: [] });
			continue;
		}
		const provider = builtinProvider(kind, choice.name)!;
		const report: KindReport = {
			kind,
			mode: 'provider',
			provider: provider.name,
			actions: [],
		};
		reports.push(report);
		if (constructsOf(manifest, kind).length === 0) {
			log(`   ${kind}: ${provider.name} — nothing declared to provision`);
			continue;
		}

		const credential = await provider.credentials({
			stage,
			env,
			...(options.profile ? { profile: options.profile } : {}),
			...(options.home ? { home: options.home } : {}),
		});
		report.credentials = credential !== undefined;
		if (credential === undefined) {
			log(
				`   ${kind}: ${provider.name} — no credentials to provision with, so ` +
					`'${stage}' is external for now: its keys ` +
					`(${provider.runtimeKeys(manifest).join(', ')}) are yours to set ` +
					`with gkm secrets:add --stage ${stage}. To have gkm create them, ` +
					`supply ${provider.provisioning.describe}` +
					(provider.provisioning.login
						? `, or run gkm login --provider ${provider.provisioning.login}`
						: '') +
					`, and run ${provisionCommand(stage)}.`,
			);
			continue;
		}
		configured.push({
			kind,
			provider,
			config: choice.config,
			credential,
			report,
		});
	}

	if (configured.length === 0) return reports;

	const identity = deployIdentity(workspace, stage);
	const secretsStore = await secretsStoreFor(workspace, stage, {
		...(options.profile ? { profile: options.profile } : {}),
		...(options.home ? { home: options.home } : {}),
	});
	let secrets = (await secretsStore.read(stage))?.custom ?? {};

	const stateStore = await createStateStore({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

	const lock = dryRun
		? undefined
		: await stateStore.lock(stage, { operation: 'provision' });
	try {
		const state: ProvisionState = dryRun
			? await readOnlyState(stateStore, stage)
			: journalState(
					await DeployJournal.open(stateStore, stage, () =>
						deploysWithCompose(workspace)
							? createComposeState(stage)
							: createEmptyState(stage, '', ''),
					),
				);

		const writeSecrets = async (values: Record<string, string>) => {
			if (dryRun) return;
			const stored =
				(await secretsStore.read(stage)) ?? initStageSecrets(stage);
			const next = {
				...stored,
				custom: { ...stored.custom, ...values },
				updatedAt: new Date().toISOString(),
			};
			await secretsStore.write(stage, next);
			secrets = next.custom;
		};

		for (const entry of configured) {
			log(
				`   ${entry.kind}: ${entry.provider.name}${dryRun ? ' (dry run)' : ''}`,
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
	} finally {
		await lock?.release();
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
	store: Awaited<ReturnType<typeof createStateStore>>,
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
