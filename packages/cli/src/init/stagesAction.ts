/**
 * How a scaffolded workflow names the `stages` action.
 *
 * A published CLI pins it to the commit it was released from: the release
 * build is given that commit as `GKM_RELEASE_COMMIT`, which the build writes
 * into the bundle (`define` in tsdown.config.ts). The action at that commit is
 * the one released beside this CLI, and a commit SHA cannot be moved under a
 * project the way a branch or a tag can.
 *
 * A CLI built anywhere else — a checkout, a local build — knows no released
 * commit, and names `main`.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function cliVersion(): string {
	try {
		return require('../package.json').version;
	} catch {
		return require('../../package.json').version;
	}
}

/** The action, as a workflow's `uses:` names it before the `@`. */
export const STAGES_ACTION = 'geekmidas/toolbox/actions/stages';

const COMMIT = /^[0-9a-f]{40}$/;

/**
 * The `uses:` value for the stages action, with a comment saying which CLI
 * release the pinned commit is.
 */
export function stagesActionUses(
	commit: string | undefined = process.env.GKM_RELEASE_COMMIT,
	version: string = cliVersion(),
): string {
	return commit && COMMIT.test(commit)
		? `${STAGES_ACTION}@${commit} # @geekmidas/cli ${version}`
		: `${STAGES_ACTION}@main # pin to a commit SHA: see the action's README`;
}
