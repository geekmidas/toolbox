/**
 * What a deployed stage's stack generates once and keeps: its seed, each
 * `secret` construct's value, the log UI's root password where its telemetry
 * is self-hosted, the stack's Redis password where a cache lives in it, and
 * each site's password where `deploy.sitePassword` asks for one.
 *
 * Pure: the compose target writes the result back to the stage's store.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import {
	type GeneratedSecrets,
	withGeneratedSecrets,
} from '../deploy/generated.js';
import { initStageSecrets } from '../secrets/storage.js';
import type { StageSecrets } from '../secrets/types.js';
import { resolveStageTelemetry } from '../telemetry/config';
import { usesTelemetry } from '../telemetry/edges';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { withLogsPassword } from './logs';
import { runsRedis, withRedisPassword } from './redis';
import { passwordSites, siteNames, withSitePasswords } from './sitePassword';

export function deployedStackSecrets(
	workspace: NormalizedWorkspace,
	stage: string,
	stored: StageSecrets | null,
	manifest: ConstructManifest,
): GeneratedSecrets {
	const withSeed = withGeneratedSecrets(
		stored ?? initStageSecrets(stage),
		manifest,
	);
	// The log UI's root password, generated once like the seed, where the
	// stage's telemetry is self-hosted and the stage set none.
	const telemetry = resolveStageTelemetry({
		...(workspace.deploy?.telemetry
			? { telemetry: workspace.deploy.telemetry }
			: {}),
		stage,
		local: false,
		target: 'compose',
		runtime: 'server',
		selfHosted: true,
		used: usesTelemetry(manifest),
	});
	const withLogs =
		telemetry?.provider === 'self-hosted'
			? withLogsPassword(withSeed.secrets)
			: { secrets: withSeed.secrets, generated: [] };
	// The stack's Redis password, the same way, where a cache lives in it.
	const withRedis = runsRedis(manifest, withLogs.secrets.custom ?? {})
		? withRedisPassword(withLogs.secrets)
		: { secrets: withLogs.secrets, generated: [] };
	// Each site's password, the same way, where the stage puts it behind one.
	const withSites = withSitePasswords(
		withRedis.secrets,
		passwordSites(workspace, stage, siteNames(manifest)),
	);
	return {
		secrets: withSites.secrets,
		generated: [
			...withSeed.generated,
			...withLogs.generated,
			...withRedis.generated,
			...withSites.generated,
		],
	};
}
