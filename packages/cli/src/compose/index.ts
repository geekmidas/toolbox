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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadWorkspaceConfig } from '../config';
import { deploy } from '../deploy/deploy';
import { deployIdentity } from '../deploy/identity.js';
import type { DeployResult } from '../deploy/types';
import {
	type ComposeDeps,
	type ComposeImage,
	ComposePinNeedsPull,
	ComposePushNeedsBuild,
	type ComposeRun,
	composeTarget,
	stackOverrideFile,
} from '../target/compose/index';
import { dockerCompose, type StackRef } from './docker';
import { edgeDir, removeEdgeRoutes } from './edge';
import { type ImageDigests, parseDigests, pinnedRef } from './images';
import { type ComposeStack, composeProject, stackDir } from './stack';
import { EDGE_PROJECT } from './traefik';

export {
	ComposeAppsUnhealthy,
	ComposePinNeedsPull,
	ComposePushNeedsBuild,
	EdgePortInvalid,
	edgePorts,
	gitRevision,
	NoGitRevision,
	RedisClientMissing,
} from '../target/compose/index';
export {
	isMissingManifest,
	NetworkCreateFailed,
	PushDigestUnknown,
} from './docker';
export { ComposeProxyClash } from './edge';
export {
	assertImagesExist,
	ImageDigestMismatch,
	ImageDigestMissing,
	ImageDigestsInvalid,
	ImageTagNotFound,
	RegistryRequired,
	RegistryUnreachable,
	siteTag,
} from './images';
export {
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
	ComposeStageUnknown,
	ComposeTlsFileMissing,
	ComposeTlsOnLocalStage,
} from './proxy';
export {
	REDIS_MAXMEMORY,
	REDIS_PASSWORD_KEY,
	RedisPasswordMissing,
	STACK_CACHE,
} from './redis';
export {
	composeStack,
	EnvValueMultiline,
	LOG_ROTATION,
	NothingToCompose,
	StageSecretMissing,
	StageSeedMissing,
} from './stack';
export {
	EDGE_NETWORK,
	EDGE_PROJECT,
	TRAEFIK_IMAGE,
	traefikDynamic,
} from './traefik';

export interface ComposeOptions {
	/** The stage to run. Always named: nothing defaults to the local stage. */
	stage: string;
	/** A release tag: pull every app's image at it, build nothing. */
	tag?: string;
	/** Build images here, whatever `--tag` says. */
	build?: boolean;
	/** Pull images, whatever `--tag` says — `latest` when no tag is given. */
	pull?: boolean;
	/**
	 * With `--build`: push every image built to `deploy.registry`, and start
	 * nothing — no provisioning, no `up`, nothing recorded. What CI runs.
	 */
	push?: boolean;
	/**
	 * With `--push`, where each pushed image's `<ref>@sha256:…` is written,
	 * as JSON by app. With `--tag`/`--pull`, the file to read them back from:
	 * each image is pulled and run at its digest rather than its tag.
	 */
	digestsFile?: string;
	/** Write the files and print the plan; touch nothing else. */
	dryRun?: boolean;
	/** Stop the stage's stack. Its volumes are kept. */
	down?: boolean;
	/** The workspace — the current directory when absent. */
	cwd?: string;
	/**
	 * `--allow-dev-services`: on a deployed stage, run the dev service for
	 * every construct the stage does not account for — MinIO for a bucket,
	 * Mailpit for mail.
	 */
	allowDevServices?: boolean;
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

/** Each pushed image as `<ref>@sha256:…`, by app. */
function pushedDigests(run: ComposeRun): ImageDigests {
	return Object.fromEntries(
		Object.entries(run.images)
			.filter(([, image]) => image.digest)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([app, image]) => [app, pinnedRef(image.ref, image.digest!)]),
	);
}

/** `gkm compose`. */
export async function composeCommand(
	options: ComposeOptions,
	deps: Partial<ComposeDeps> = {},
): Promise<ComposeResult | undefined> {
	if (options.build && options.pull) throw new ComposeModeConflict();
	if (options.push && !options.build) throw new ComposePushNeedsBuild();
	const pulls = !options.build && (options.pull || options.tag !== undefined);
	if (options.digestsFile && !options.push && !pulls) {
		throw new ComposePinNeedsPull();
	}

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
		// Unregistered from the shared edge first, so it stops routing to the
		// stack before the stack stops. The edge keeps serving every other
		// stack — and keeps running.
		if (await removeEdgeRoutes(edgeDir(deps.env ?? process.env), ref.project)) {
			console.log(`🌐 Removed ${ref.project}'s routes from ${EDGE_PROJECT}.`);
		}
		await (deps.docker ?? dockerCompose).down(ref);
		console.log(`🛑 Stopped ${ref.project}. Its volumes are kept.`);
		return undefined;
	}

	let finished: ComposeRun | undefined;
	const mode = options.build ? 'build' : options.pull ? 'pull' : undefined;
	const tag = options.tag ?? (options.pull ? 'latest' : undefined);

	// A pinned release: each image at the digest its push reported.
	const pin =
		options.digestsFile && pulls
			? {
					file: options.digestsFile,
					digests: parseDigests(
						options.digestsFile,
						await readFile(resolve(cwd, options.digestsFile), 'utf-8'),
					),
				}
			: undefined;

	const run = deploy({
		cwd,
		stage,
		target: 'compose',
		// The target with this command's switches, in place of the built-in.
		targets: {
			compose: composeTarget({
				...deps,
				...(mode ? { mode } : {}),
				...(options.push ? { push: true } : {}),
				...(pin ? { pin } : {}),
				report: (done) => {
					finished = done;
				},
			}),
		},
		...(tag ? { tag } : {}),
		...(options.dryRun ? { dryRun: true } : {}),
		...(options.push ? { buildOnly: true } : {}),
		...(options.allowDevServices ? { allowDevServices: true } : {}),
		logger: {
			info: (message) => console.log(message),
			warn: (message) => console.warn(message),
			error: (message) => console.error(message),
		},
	});
	const result = await run.result;
	if (!finished) return undefined;

	if (options.push && !options.dryRun) {
		const digests = pushedDigests(finished);
		console.log(`\n✅ Pushed ${Object.keys(digests).length} image(s):`);
		for (const [app, ref] of Object.entries(digests)) {
			console.log(`   ${app.padEnd(12)} ${ref}`);
		}
		if (options.digestsFile) {
			const file = resolve(cwd, options.digestsFile);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, `${JSON.stringify(digests, null, 2)}\n`);
			console.log(`\n📝 Wrote the digests to ${options.digestsFile}`);
		}
	}

	return {
		stack: finished.stack,
		files: finished.files,
		...(options.dryRun ? {} : { images: finished.images }),
		deploy: result,
	};
}
