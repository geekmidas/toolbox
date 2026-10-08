/**
 * What a deployed stage's stack generates once and keeps: its seed, each
 * `secret` construct's value, the log UI's root password where its telemetry
 * is self-hosted, and the stack's Redis password where a cache lives in it.
 *
 * Pure: the compose target writes the result back to the stage's store, and
 * `gkm setup`'s DNS step composes the stack with it to read the stack's hosts,
 * writing nothing.
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
	return {
		secrets: withRedis.secrets,
		generated: [
			...withSeed.generated,
			...withLogs.generated,
			...withRedis.generated,
		],
	};
}
