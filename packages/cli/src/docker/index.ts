import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { type ConstructManifest, publicEnvFor } from '@geekmidas/manifest';
import { loadWorkspaceConfig } from '../config';
import { output } from '../output';
import { dockerfileOf } from '../reconcile/apps.js';
import { COMPOSE_PATH } from '../reconcile/index.js';
import { reconcileWorkspace } from '../reconcile/workspace.js';
import { run } from '../run';
import { getPublicUrlArgNames } from '../target/dokploy/domain.js';
import type { GkmConfig } from '../types';
import { appKey } from '../workspace/derive.js';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';
import { validateImageRef } from './imageRef';
import { appImageOptions, type ImageLayout, imageLayout } from './layout';
import {
	generateBackendDockerfile,
	generateDockerignore,
	generateEntryDockerfile,
	generateNextjsDockerfile,
	generateNodeWebDockerfile,
	generateViteStaticDockerfile,
	resolveDockerConfig,
} from './templates';

export { ImageRefInvalid, validateImageRef } from './imageRef';
export {
	appImageOptions,
	composeBuildPaths,
	fromBuildRoot,
	type ImageLayout,
	imageLayout,
	MonorepoNeedsTurbo,
} from './layout';
export {
	detectPackageManager,
	findBuildRoot,
	findLockfilePath,
	hasTurboConfig,
	isMonorepo,
} from './templates';

// Through `output`, so a deploy run that generates a Dockerfile hears it.
const logger = output;

/** `docker build` failed; what docker printed above says why. */
export class DockerBuildFailed extends Error {
	constructor(
		readonly imageRef: string,
		cause: unknown,
	) {
		super(
			`Failed to build Docker image: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
		this.name = 'DockerBuildFailed';
	}
}

/** `docker push` failed — usually the registry login or its permissions. */
export class DockerPushFailed extends Error {
	constructor(
		readonly imageRef: string,
		cause: unknown,
	) {
		super(
			`Failed to push Docker image: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
		this.name = 'DockerPushFailed';
	}
}

/** `gkm docker --push` was asked for with nowhere to push to. */
export class PushNeedsRegistry extends Error {
	constructor(readonly imageName: string) {
		super(
			`Registry is required to push Docker image '${imageName}'. Use --registry or configure docker.registry in gkm.config.ts`,
		);
		this.name = 'PushNeedsRegistry';
	}
}

export interface DockerOptions {
	/** Build each app's image after generating files */
	build?: boolean;
	/** Push the images to the registry after building */
	push?: boolean;
	/** Image tag (default: 'latest') */
	tag?: string;
	/** Container registry URL */
	registry?: string;
	/**
	 * The directory to generate for — an app's own, when a deploy builds it.
	 * Defaults to the process's working directory.
	 */
	cwd?: string;
}

/**
 * Docker command implementation: one Dockerfile per deployable app, each
 * building its image inside Docker from a turbo-pruned slice of the build
 * root — nothing is built on the host — plus the build root's
 * `.dockerignore` and `docker-compose.constructs.yml`.
 */
export async function dockerCommand(
	options: DockerOptions,
): Promise<WorkspaceDockerResult> {
	const cwd = options.cwd ?? process.cwd();
	const loaded = await loadWorkspaceConfig(cwd);

	// A single-app config is a workspace of one app at its root; the image is
	// named the way its `docker` block says.
	const names: Record<string, string> =
		loaded.type === 'single'
			? Object.fromEntries(
					Object.keys(loaded.workspace.apps).map((name) => [
						name,
						resolveDockerConfig(loaded.raw as GkmConfig).imageName,
					]),
				)
			: {};

	const result = await workspaceDockerCommand(
		loaded.workspace,
		loaded.manifest,
		names,
	);

	if (options.build) {
		for (const app of result.apps) {
			await buildDockerImage(app, result.buildRoot, options);
		}
	}
	if (options.push) {
		for (const app of result.apps) {
			await pushDockerImage(app.imageName, options, result.buildRoot);
		}
	}

	return result;
}

/**
 * Build one app's image, from the build root.
 * Uses BuildKit for cache mount support
 */
async function buildDockerImage(
	app: AppDockerResult,
	buildRoot: string,
	options: DockerOptions,
): Promise<void> {
	const tag = options.tag ?? 'latest';
	const registry = options.registry;

	// Before anything runs: a ref docker would misread is refused by name.
	const fullImageName = validateImageRef(
		registry
			? `${registry}/${app.imageName}:${tag}`
			: `${app.imageName}:${tag}`,
	);

	logger.log(`\n🐳 Building Docker image: ${fullImageName}`);

	try {
		// An argument array, so nothing in the ref is read by a shell, and
		// `--tag=` so it cannot be read as a flag.
		await run(
			'docker',
			[
				'build',
				`--file=${relative(buildRoot, app.dockerfile)}`,
				`--tag=${fullImageName}`,
				'.',
			],
			{
				cwd: buildRoot,
				// BuildKit, for the templates' `RUN --mount=type=cache`.
				env: { ...process.env, DOCKER_BUILDKIT: '1' },
			},
		);
		logger.log(`✅ Docker image built: ${fullImageName}`);
	} catch (error) {
		throw new DockerBuildFailed(fullImageName, error);
	}
}

/**
 * Push Docker image to registry
 */
async function pushDockerImage(
	imageName: string,
	options: DockerOptions,
	cwd: string,
): Promise<void> {
	const tag = options.tag ?? 'latest';
	const registry = options.registry;

	if (!registry) {
		throw new PushNeedsRegistry(imageName);
	}

	const fullImageName = validateImageRef(`${registry}/${imageName}:${tag}`);

	logger.log(`\n🚀 Pushing Docker image: ${fullImageName}`);

	try {
		await run('docker', ['push', fullImageName], { cwd });
		logger.log(`✅ Docker image pushed: ${fullImageName}`);
	} catch (error) {
		throw new DockerPushFailed(fullImageName, error);
	}
}

/**
 * Result of generating Docker files for a single app in a workspace.
 */
export interface AppDockerResult {
	appName: string;
	type: 'backend' | 'web' | 'mobile';
	/** The Dockerfile, absolute. */
	dockerfile: string;
	imageName: string;
}

/**
 * Result of workspace docker command.
 */
export interface WorkspaceDockerResult {
	apps: AppDockerResult[];
	dockerCompose: string;
	dockerignore: string;
	/** Every image's build context, absolute. */
	buildRoot: string;
}

/**
 * Generate Dockerfiles for all apps in a workspace.
 * @internal Exported for testing
 */
export async function workspaceDockerCommand(
	workspace: NormalizedWorkspace,
	/** What the workspace declares — where a site's public keys come from. */
	manifest?: ConstructManifest,
	/** Image names other than the app's own. */
	imageNames: Readonly<Record<string, string>> = {},
): Promise<WorkspaceDockerResult> {
	const results: AppDockerResult[] = [];
	const layout = imageLayout(workspace);

	logger.log(`\n🐳 Generating Dockerfiles for workspace: ${workspace.name}`);
	logger.log(`   Build root: ${layout.buildRoot}`);
	logger.log(
		`   Package manager: ${layout.tools.packageManager}${layout.tools.packageManagerVersion ? `@${layout.tools.packageManagerVersion}` : ''}, turbo@${layout.tools.turboVersion}`,
	);

	for (const [appName, app] of Object.entries(workspace.apps)) {
		// Mobile apps deploy via their own toolchain (e.g. EAS Build for Expo)
		// — no Docker image is produced.
		if (app.type === 'mobile') {
			logger.log(
				`\n   📱 Skipping Docker for ${appName} (mobile app — deploy via framework toolchain)`,
			);
			continue;
		}

		const buildType = app.entry ? 'entry' : app.type;
		logger.log(`\n   📄 Generating Dockerfile for ${appName} (${buildType})`);

		const dockerfile = appDockerfile(appName, app, {
			layout,
			workspaceRoot: workspace.root,
			...(manifest ? { manifest } : {}),
		});

		const path = dockerfileOf(appName, app.path);
		const dockerfilePath = join(workspace.root, path);
		await mkdir(dirname(dockerfilePath), { recursive: true });
		await writeFile(dockerfilePath, dockerfile);
		logger.log(`      Generated: ${path}`);

		results.push({
			appName,
			type: app.type,
			dockerfile: dockerfilePath,
			imageName: imageNames[appName] ?? appName,
		});
	}

	const dockerignorePath = await ensureDockerignore(layout.buildRoot);
	logger.log(`\n   Ensured: ${dockerignorePath}`);

	const composePath = await writeConstructsCompose(workspace);

	// Summary
	logger.log(
		`\n✅ Generated ${results.length} Dockerfile(s) + ${COMPOSE_PATH}`,
	);
	logger.log(`\n📋 Build commands (from ${layout.buildRoot}):`);
	for (const result of results) {
		const icon =
			result.type === 'backend' ? '⚙️' : result.type === 'mobile' ? '📱' : '🌐';
		logger.log(
			`   ${icon} docker build -f ${relative(layout.buildRoot, result.dockerfile)} -t ${result.imageName} .`,
		);
	}
	printRunInstructions(workspace);

	return {
		apps: results,
		dockerCompose: composePath,
		dockerignore: dockerignorePath,
		buildRoot: layout.buildRoot,
	};
}

/**
 * One app's Dockerfile, by what it is: a gkm backend bundled by `gkm build`,
 * a backend with its own entry bundled by esbuild, or a site by its
 * framework. The one choice every builder of images makes.
 */
export function appDockerfile(
	appName: string,
	app: NormalizedAppConfig,
	options: {
		layout: ImageLayout;
		workspaceRoot: string;
		manifest?: ConstructManifest;
		/** A site's public keys, when the caller resolved them itself. */
		publicUrlArgs?: string[];
	},
): string {
	const image = appImageOptions(
		options.layout,
		appName,
		app,
		options.workspaceRoot,
	);

	if (app.type === 'web') {
		return siteDockerfile(appName, app, {
			image,
			...(options.manifest ? { manifest: options.manifest } : {}),
			...(options.publicUrlArgs
				? { publicUrlArgs: options.publicUrlArgs }
				: {}),
		});
	}
	if (app.entry) {
		return generateEntryDockerfile({
			...image,
			entry: app.entry,
			healthCheckPath: '/health',
		});
	}
	return generateBackendDockerfile({ ...image, healthCheckPath: '/health' });
}

/**
 * A site's Dockerfile, with an `ARG` for every key its bundler inlines.
 *
 * The keys come from the site's declaration where there is one — every
 * public key its edges give it, `VITE_UPLOADS_SERVER_URL` included — and an
 * `ARG` the Dockerfile does not declare is a build argument the build drops,
 * leaving the bundle with an empty URL.
 */
export function siteDockerfile(
	appName: string,
	app: NormalizedAppConfig,
	options: {
		image: ReturnType<typeof appImageOptions>;
		manifest?: ConstructManifest;
		publicUrlArgs?: string[];
	},
): string {
	const declared = options.manifest
		? Object.entries(options.manifest).find(
				([id, d]) => d.kind === 'site' && appKey(id) === appName,
			)?.[1]
		: undefined;
	const publicUrlArgs =
		options.publicUrlArgs ??
		(declared?.kind === 'site' && options.manifest
			? Object.keys(publicEnvFor(declared, options.manifest))
			: getPublicUrlArgNames(app));

	const webOpts = { ...options.image, publicUrlArgs };

	switch (app.framework) {
		case 'vite':
			return generateViteStaticDockerfile(webOpts);
		case 'tanstack-start':
		case 'remix':
			return generateNodeWebDockerfile(webOpts);
		default:
			// nextjs (and any unspecified web framework — schema requires a valid
			// framework, so this is just a default).
			return generateNextjsDockerfile(webOpts);
	}
}

/**
 * What a build root's `.dockerignore` must leave out of every image's
 * context: dependencies installed for another platform, anything built on the
 * host (every image builds from source), git, and gkm's own output —
 * `.gkm/compose`'s env files hold a stage's secrets.
 */
const REQUIRED_IGNORES = [
	'**/node_modules',
	'.git',
	'**/dist',
	'**/.next',
	'**/.turbo',
	'**/.gkm',
	'**/.gkm/compose',
];

/**
 * Make sure the build root's `.dockerignore` leaves out what no image may
 * hold: written whole where there is none, and each missing line appended to
 * one the project keeps.
 */
export async function ensureDockerignore(buildRoot: string): Promise<string> {
	const path = join(buildRoot, '.dockerignore');
	if (!existsSync(path)) {
		await writeFile(path, generateDockerignore());
		return path;
	}

	const current = await readFile(path, 'utf-8');
	const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
	const missing = REQUIRED_IGNORES.filter((line) => !lines.has(line));
	if (missing.length === 0) return path;

	await appendFile(
		path,
		`${current.endsWith('\n') || current === '' ? '' : '\n'}\n# gkm: images build from source, and a stack's env files hold its secrets\n${missing.join('\n')}\n`,
	);
	return path;
}

/**
 * Write `docker-compose.constructs.yml` — the same file `gkm dev` writes, with
 * the apps beside the containers their constructs derive.
 *
 * Through reconcile rather than a second generator, so what `gkm docker`
 * describes and what `gkm dev` runs cannot disagree. Nothing is started.
 */
async function writeConstructsCompose(
	workspace: NormalizedWorkspace,
): Promise<string> {
	await reconcileWorkspace(workspace, {
		stage: workspace.stages.local,
		start: false,
	});
	logger.log(`   Generated: ${COMPOSE_PATH} (project root)`);
	return join(workspace.root, COMPOSE_PATH);
}

function printRunInstructions(workspace: NormalizedWorkspace): void {
	const project = existsSync(join(workspace.root, 'docker-compose.yml'))
		? ' -f docker-compose.yml'
		: '';
	logger.log('\n📋 Run everything (the apps sit behind the "apps" profile):');
	logger.log(
		'   gkm setup   # starts the containers and creates what they hold',
	);
	logger.log(
		`   docker compose -f ${COMPOSE_PATH}${project} --profile apps up --build`,
	);
}
