/**
 * What the deploy's DNS step needs to know about a workspace before its
 * stack is run: whether it deploys with compose, and the hosts a stage's
 * stack serves.
 *
 * The step itself is `stageDns` in `compose/dns.ts`, run by every deploy
 * (`gkm deploy`, and `gkm compose`, the same run) — or by
 * `gkm deploy --resources-only` on a CI runner, where the DNS provider's
 * token is, before the server deploys with `--skip-resources`. The server
 * never holds the token.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import { stackHosts } from '../compose/dns.js';
import { deployIdentity } from '../deploy/identity.js';
import type { StageSecrets } from '../secrets/types.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/** Whether the workspace deploys through the compose target. */
export function deploysWithCompose(workspace: NormalizedWorkspace): boolean {
	return (
		workspace.deploy?.default === 'compose' ||
		Object.values(workspace.apps).some(
			(app) => app.resolvedDeployTarget === 'compose',
		)
	);
}

/**
 * The hosts a compose stage serves: its stack composed as a deploy would —
 * with the secrets it would generate made up in memory, never written — and
 * every route's host read off it.
 */
export async function composeStageHosts(options: {
	workspace: NormalizedWorkspace;
	stage: string;
	/** The stage's secrets as stored. */
	stored: StageSecrets | null;
	manifest: ConstructManifest;
	runnables: Record<string, string[]>;
	background: Record<string, string[]>;
}): Promise<string[]> {
	const { workspace, stage, manifest } = options;
	const { deployedStackSecrets } = await import('../compose/secrets.js');
	const { composeStack } = await import('../compose/stack.js');
	const { secrets } = deployedStackSecrets(
		workspace,
		stage,
		options.stored,
		manifest,
	);
	const stack = composeStack({
		workspace,
		manifest,
		runnables: options.runnables,
		background: options.background,
		stage,
		identity: deployIdentity(workspace, stage),
		images: {
			mode: 'pull',
			tag: 'dns',
			...(workspace.deploy?.registry
				? { registry: workspace.deploy.registry }
				: {}),
		},
		secrets,
		// Only the routes are read: no backend's environment is resolved, and
		// a construct the stage does not account for yet is not a refusal here
		// — the deploy on the server is where that is said.
		buildOnly: true,
		allowDevServices: true,
	});
	return stackHosts(stack);
}
