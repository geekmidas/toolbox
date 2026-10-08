/**
 * What a deploy's checks read off `deploy.<kind>.<stage>`, without loading a
 * provider: which kinds the stage accounts for, what creates a missing key,
 * and a kind the stage has none of.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import type { StageProviderNotes } from '../deploy/devServices.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { provisioningOf, stageProvider } from './config.js';
import { PROVIDER_KINDS, type ProviderKind } from './types.js';

/** The constructs of a kind: `objects` is every bucket. */
export function constructsOf(manifest: ConstructManifest, kind: ProviderKind) {
	return Object.entries(manifest)
		.filter(([, d]) => d.kind === kind)
		.map(([id]) => id)
		.sort();
}

/** A stage that names `false` for a kind, and declares constructs of it. */
export class StageProviderDisabled extends Error {
	constructor(
		readonly kind: ProviderKind,
		readonly stage: string,
		readonly ids: readonly string[],
	) {
		super(
			`deploy.${kind}.${stage} is false — the stage has no ${kind} — and ` +
				`${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} declared. ` +
				`Name what backs ${ids.length === 1 ? 'it' : 'them'} on '${stage}' ` +
				`(deploy.${kind}.${stage}: 'external', or a provider), or remove ` +
				`the ${ids.length === 1 ? 'construct' : 'constructs'}.`,
		);
		this.name = 'StageProviderDisabled';
	}
}

/** The command a stage's providers are run with. */
export function provisionCommand(stage: string): string {
	return `gkm setup --stage ${stage}`;
}

/**
 * The line a stage missing a key a provider would write is given: what
 * creates it, and with which credentials. Undefined when no provider backs
 * the kind on the stage.
 */
export function provisionHint(
	workspace: Pick<NormalizedWorkspace, 'deploy' | 'stages'>,
	kind: ProviderKind,
	stage: string,
): string | undefined {
	const choice = stageProvider(workspace as never, kind, stage);
	if (choice.mode !== 'provider') return undefined;
	const provisioning = provisioningOf(kind, choice.name);
	if (!provisioning) return undefined;
	return (
		`deploy.${kind}.${stage} is ${choice.name}: ${provisionCommand(stage)} ` +
		`creates it and writes this key, with ${provisioning.describe}` +
		(provisioning.login
			? `, or gkm login --provider ${provisioning.login}`
			: '')
	);
}

/**
 * What a deploy's checks read off the stage's providers: whether each kind is
 * accounted for — a provider, or `false` — so no dev service stands in for
 * it, and what creates a missing key of it.
 */
export function stageProviderNotes(
	workspace: Pick<NormalizedWorkspace, 'deploy' | 'stages'>,
	stage: string,
): StageProviderNotes {
	const choice = stageProvider(workspace as never, 'objects', stage);
	if (choice.mode === 'external') return {};
	const hint = provisionHint(workspace, 'objects', stage);
	return { objects: { accounted: true, ...(hint ? { hint } : {}) } };
}

/**
 * A kind the stage set to `false`, declared anyway — refused before anything
 * else is checked. Pure: what a stack is composed from.
 *
 * @throws {StageProviderDisabled}
 */
export function assertStageProvidersEnabled(
	workspace: Pick<NormalizedWorkspace, 'deploy' | 'stages'>,
	manifest: ConstructManifest,
	stage: string,
): void {
	for (const kind of PROVIDER_KINDS) {
		const ids = constructsOf(manifest, kind);
		if (ids.length === 0) continue;
		if (stageProvider(workspace as never, kind, stage).mode === 'none') {
			throw new StageProviderDisabled(kind, stage, ids);
		}
	}
}
