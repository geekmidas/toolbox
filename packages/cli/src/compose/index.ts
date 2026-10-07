/**
 * `gkm compose` — a workspace's APIs and sites for one stage, as one Docker
 * Compose stack behind Caddy.
 *
 * A convenience over `gkm deploy --target compose`: the stage defaults to the
 * local one, `--build`/`--pull` choose the images whatever `--tag` says, and
 * `--down` stops the stack. Everything else — the order, the image check, the
 * state, the health checks — is the compose target's, run through the same
 * `deploy()` as any other target, so there is one way a stack comes up.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadWorkspaceConfig } from '../config';
import { deploy } from '../deploy/deploy';
import { parseDevServices } from '../deploy/devServices';
import { deployIdentity } from '../deploy/identity.js';
import type { DeployResult } from '../deploy/types';
import {
	type ComposeDeps,
	type ComposeImage,
	type ComposeRun,
	composeTarget,
	stackOverrideFile,
} from '../target/compose/index';
import { dockerCompose, type StackRef } from './docker';
import { type ComposeStack, composeProject, stackDir } from './stack';

export {
	ComposeAppsUnhealthy,
	EdgePortInvalid,
	edgePorts,
	gitRevision,
	NoGitRevision,
} from '../target/compose/index';
export { isMissingManifest } from './docker';
export {
	assertImagesExist,
	ImageTagNotFound,
	RegistryUnreachable,
	siteTag,
} from './images';
export {
	LogsEndpointConflict,
	LogsPasswordMissing,
	LogsPasswordWeak,
	OPENOBSERVE_IMAGE,
} from './logs';
export {
	LogsAllowEmpty,
	LogsAllowEntryInvalid,
	LogsPortInvalid,
	LogsRetentionInvalid,
} from './logsConfig';
export {
	composeStack,
	EnvValueMultiline,
	LOG_ROTATION,
	NothingToCompose,
	StageSecretMissing,
	StageSeedMissing,
} from './stack';

export interface ComposeOptions {
	/** The stage to run. Always named: nothing defaults to the local stage. */
	stage: string;
	/** A release tag: pull every app's image at it, build nothing. */
	tag?: string;
	/** Build images here, whatever `--tag` says. */
	build?: boolean;
	/** Pull images, whatever `--tag` says — `latest` when no tag is given. */
	pull?: boolean;
	/** Write the files and print the plan; touch nothing else. */
	dryRun?: boolean;
	/** Stop the stage's stack. Its volumes are kept. */
	down?: boolean;
	/** The workspace — the current directory when absent. */
	cwd?: string;
	/**
	 * `--allow-dev-services minio,mailpit`: on a deployed stage, run MinIO
	 * and Mailpit for the buckets and mail its secrets do not configure.
	 */
	allowDevServices?: string | readonly string[];
}

export interface ComposeResult {
	stack: ComposeStack;
	/** Every file written, absolute. */
	files: string[];
	/** Each app's recorded image — absent on a dry run. */
	images?: Record<string, ComposeImage>;
	/** What the deploy reports, as `gkm deploy --target compose` would. */
	deploy: DeployResult;
}

/** `--build` and `--pull` together ask for two different things. */
export class ComposeModeConflict extends Error {
	constructor() {
		super(
			'--build and --pull ask for opposite things: build images from this ' +
				'checkout, or pull a tag CI pushed. Pass one of them.',
		);
		this.name = 'ComposeModeConflict';
	}
}

/** `gkm compose`. */
export async function composeCommand(
	options: ComposeOptions,
	deps: Partial<ComposeDeps> = {},
): Promise<ComposeResult | undefined> {
	if (options.build && options.pull) throw new ComposeModeConflict();
	const allowDevServices = parseDevServices(options.allowDevServices);

	const cwd = resolve(options.cwd ?? process.cwd());
	// Read here only for what the command adds: the project `--down` stops. The deploy loads it again, as it
	// loads every project, in its sandbox.
	const { workspace } = await loadWorkspaceConfig(cwd);
	const { stage } = options;

	if (options.down) {
		const override = stackOverrideFile(workspace.root, stage);
		const ref: StackRef = {
			project: composeProject(deployIdentity(workspace, stage)),
			file: join(workspace.root, stackDir(stage), 'docker-compose.yml'),
			...(existsSync(override) ? { overrides: [override] } : {}),
			cwd: workspace.root,
		};
		await (deps.docker ?? dockerCompose).down(ref);
		console.log(`🛑 Stopped ${ref.project}. Its volumes are kept.`);
		return undefined;
	}

	let finished: ComposeRun | undefined;
	const mode = options.build ? 'build' : options.pull ? 'pull' : undefined;
	const tag = options.tag ?? (options.pull ? 'latest' : undefined);

	const run = deploy({
		cwd,
		stage,
		target: 'compose',
		// The target with this command's switches, in place of the built-in.
		targets: {
			compose: composeTarget({
				...deps,
				...(mode ? { mode } : {}),
				report: (done) => {
					finished = done;
				},
			}),
		},
		...(tag ? { tag } : {}),
		...(options.dryRun ? { dryRun: true } : {}),
		...(allowDevServices.length > 0 ? { allowDevServices } : {}),
		logger: {
			info: (message) => console.log(message),
			warn: (message) => console.warn(message),
			error: (message) => console.error(message),
		},
	});
	const result = await run.result;
	if (!finished) return undefined;

	return {
		stack: finished.stack,
		files: finished.files,
		...(options.dryRun ? {} : { images: finished.images }),
		deploy: result,
	};
}
