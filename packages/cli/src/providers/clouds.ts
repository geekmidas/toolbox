/**
 * Which clouds a stage needs credentials for — the one answer `gkm deploy`,
 * `gkm deploy:github` and the deploy workflow all read, so none of them can
 * think a stage needs AWS or Google when another does not.
 *
 * AWS: the workspace keeps its secrets or its deploy state there, or one of
 * the stage's providers provisions there. Google: one of the stage's
 * providers provisions there.
 *
 * A provider says its own cloud (`ResourceProvider.cloud`), so a new kind —
 * a `MobileApp` on `google-play`, `Maps` on `google` — counts here the moment
 * it is in `PROVIDER_KINDS` and the registry, with nothing to add.
 */

import { awsSecretsRegion } from '../stages/index.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { stageProvider } from './config.js';
import { builtinProvider } from './registry.js';
import {
	type GoogleCiGrant,
	PROVIDER_KINDS,
	type ProviderCloud,
} from './types.js';

export type StageClouds = Record<ProviderCloud, boolean>;

/** The clouds whose credentials a deploy of `stage` needs. */
export function stageClouds(
	workspace: Pick<NormalizedWorkspace, 'deploy' | 'stages' | 'secrets'> & {
		state?: NormalizedWorkspace['state'];
	},
	stage: string,
): StageClouds {
	const clouds: StageClouds = { aws: false, google: false };
	if (stage === workspace.stages.local) return clouds;
	for (const kind of PROVIDER_KINDS) {
		const choice = stageProvider(workspace as never, kind, stage);
		if (choice.mode !== 'provider') continue;
		const provider = builtinProvider(kind, choice.name);
		if (provider) clouds[provider.cloud] = true;
	}
	const state = workspace.state?.provider;
	if (
		awsSecretsRegion(workspace as NormalizedWorkspace) !== '' ||
		state === 'ssm' ||
		state === 's3'
	) {
		clouds.aws = true;
	}
	return clouds;
}

/**
 * Every role the stage's CI identity holds in Google Cloud: what each of the
 * stage's Google providers says its deploy from CI needs. `gkm deploy:github`
 * grants exactly these, so a provider that is removed takes its roles with it.
 */
export function stageGoogleGrants(
	workspace: NormalizedWorkspace,
	stage: string,
	project?: string,
): GoogleCiGrant[] {
	if (stage === workspace.stages.local) return [];
	const grants: GoogleCiGrant[] = [];
	for (const kind of PROVIDER_KINDS) {
		const choice = stageProvider(workspace as never, kind, stage);
		if (choice.mode !== 'provider') continue;
		const provider = builtinProvider(kind, choice.name);
		if (provider?.cloud !== 'google' || !provider.ciGrants) continue;
		grants.push(
			...provider.ciGrants({
				workspace,
				stage,
				config: choice.config,
				...(project ? { project } : {}),
			}),
		);
	}
	return grants;
}
