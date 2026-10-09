/**
 * What the deploy's DNS step needs to know about a workspace before its
 * stack is run: whether it deploys with compose.
 *
 * The step itself is `stageDns` in `compose/dns.ts`, run by every deploy
 * (`gkm deploy`, and `gkm compose`, the same run) where the deploy runs — a
 * CI runner or a developer's machine, which hold the DNS provider's token.
 * The server never does.
 */

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
