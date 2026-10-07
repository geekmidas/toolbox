/**
 * The built-in `compose` target: a stage as one Docker Compose stack behind
 * Caddy, on the machine that runs the deploy.
 *
 * ```bash
 * gkm deploy --target compose --stage production --tag v1.4.0  # what CI pushed
 * gkm deploy --target compose --stage production               # built from here
 * gkm deploy --target compose --stage development              # the local stage
 * ```
 *
 * - `validate`: the stack (`composeStack`, pure) and, for a tag, every image
 *   looked up in the registry — `ImageTagNotFound` before anything changes
 * - `plan`: the stack's files and what a run would create or reuse
 * - `provision`: generated secrets kept, files written, infrastructure up,
 *   databases, roles, grants and migrations
 * - `build`: each backend bundled on the host and every image built — or, for
 *   a tag, pulled
 * - `release`: `up --wait --remove-orphans`, and each app's image, tag and
 *   digest in the stage's state
 * - `verify`: each app asked through Caddy over HTTPS
 *
 * `gkm compose` is this target with a few more switches (`--build`, `--pull`,
 * `--down`), run through the same `deploy()`.
 */

import { defineTarget } from '../define';
import type { DeployTarget } from '../types';
import {
	buildCompose,
	type ComposeDeps,
	type ComposeRun,
	composeResult,
	defaultDeps,
	planCompose,
	provisionCompose,
	releaseCompose,
	validateCompose,
	verifyCompose,
} from './phases';

export {
	ComposeAppsUnhealthy,
	type HealthProbe,
	type HealthRequest,
	HealthRequestTimedOut,
} from './health';
export {
	BundleFailed,
	CliEntryNotFound,
	type ComposeDeps,
	type ComposeImage,
	type ComposeRun,
	EdgePortInvalid,
	edgePorts,
	gitRevision,
	NoGitRevision,
} from './phases';

export interface ComposeTargetOptions extends Partial<ComposeDeps> {
	/**
	 * Build or pull whatever the tag says. By default a given tag is pulled
	 * and no tag builds from the checkout.
	 */
	mode?: 'build' | 'pull';
	/** Handed the finished run — `gkm compose` prints and returns from it. */
	report?: (run: ComposeRun) => void;
}

/** The compose target, with its Docker, bundler and probe as given. */
export function composeTarget(
	options: ComposeTargetOptions = {},
): DeployTarget<undefined, ComposeRun> {
	const { mode, report, ...given } = options;
	const deps: ComposeDeps = { ...defaultDeps, ...given };

	return defineTarget<undefined, ComposeRun>({
		name: 'compose',
		runtime: 'server',
		capabilities: {
			rollback: false,
			migrations: 'target',
			images: true,
			// The stack runs where the deploy does, so the local stage is one
			// it can run — the `gkm dev` hostnames, behind Caddy's own CA.
			localStage: true,
		},
		// Images are pulled with this machine's own `docker login`.
		credentials: [],
		// Built from the checkout, an image is named after its commit.
		tag: ({ cwd }) => deps.revision(cwd),
		validate: (ctx) => validateCompose(ctx, deps, mode),
		plan: (ctx, run) => planCompose(ctx, run),
		provision: (ctx, run) => provisionCompose(ctx, run, deps),
		build: (ctx, run) => buildCompose(ctx, run, deps),
		release: (ctx, run) => releaseCompose(ctx, run, deps),
		verify: (ctx, run) => verifyCompose(ctx, run, deps),
		result: (ctx, run) => {
			report?.(run);
			return composeResult(ctx, run);
		},
	});
}
