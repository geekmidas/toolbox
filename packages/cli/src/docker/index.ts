import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { type ConstructManifest, publicEnvFor } from '@geekmidas/manifest';
import { loadConfig, loadWorkspaceConfig } from '../config';
import { getPublicUrlArgNames } from '../deploy/domain.js';
import { COMPOSE_PATH } from '../reconcile/index.js';
import { reconcileWorkspace } from '../reconcile/workspace.js';
import { run } from '../run';
import { appKey } from '../workspace/derive.js';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';
import { validateImageRef } from './imageRef';
import {
	detectPackageManager,
	findLockfilePath,
	generateBackendDockerfile,
	generateDockerEntrypoint,
	generateDockerignore,
	generateEntryDockerfile,
	generateMultiStageDockerfile,
	generateNextjsDockerfile,
	generateNodeWebDockerfile,
	generateSlimDockerfile,
	generateViteStaticDockerfile,
	hasTurboConfig,
	isMonorepo,
	type PackageManager,
	resolveDockerConfig,
} from './templates';

export { ImageRefInvalid, validateImageRef } from './imageRef';
export {
	detectPackageManager,
	findLockfilePath,
	hasTurboConfig,
	isMonorepo,
} from './templates';

const logger = console;

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
	/** Build Docker image after generating files */
	build?: boolean;
	/** Push image to registry after building */
	push?: boolean;
	/** Image tag (default: 'latest') */
	tag?: string;
	/** Container registry URL */
	registry?: string;
	/** Use slim Dockerfile (requires pre-built bundle from `gkm build --production`) */
	slim?: boolean;
	/** Enable turbo prune for monorepo optimization */
	turbo?: boolean;
	/** Package name for turbo prune (defaults to package.json name) */
	turboPackage?: string;
}

export interface DockerGeneratedFiles {
	dockerfile: string;
	dockerCompose: string;
	dockerignore: string;
	entrypoint: string;
}

/**
 * Docker command implementation
 * Generates Dockerfile, docker-compose.yml, and related files
 *
 * Default: Multi-stage Dockerfile that builds from source inside Docker
 * --slim: Slim Dockerfile that copies pre-built bundle (requires prior build)
 */
export async function dockerCommand(
	options: DockerOptions,
): Promise<DockerGeneratedFiles | WorkspaceDockerResult> {
	// Load config with workspace detection
	const loadedConfig = await loadWorkspaceConfig();

	// Route to workspace docker mode for multi-app workspaces
	if (loadedConfig.type === 'workspace') {
		logger.log('📦 Detected workspace configuration');
		return workspaceDockerCommand(
			loadedConfig.workspace,
			loadedConfig.manifest,
		);
	}

	// Single-app mode - use existing logic
	const config = await loadConfig();
	const dockerConfig = resolveDockerConfig(config);

	const healthCheckPath = '/health';

	// Determine Dockerfile type
	// Default: Multi-stage (builds inside Docker for reproducibility)
	// --slim: Requires pre-built bundle
	const useSlim = options.slim === true;

	if (useSlim) {
		// Verify pre-built bundle exists for slim mode
		const distDir = join(process.cwd(), '.gkm', 'server', 'dist');
		const hasBuild = existsSync(join(distDir, 'server.mjs'));

		if (!hasBuild) {
			throw new Error(
				'Slim Dockerfile requires a pre-built bundle. Run `gkm build --provider server --production` first, or omit --slim to use multi-stage build.',
			);
		}
	}

	// Generate Docker files
	const dockerDir = join(process.cwd(), '.gkm', 'docker');
	await mkdir(dockerDir, { recursive: true });

	// Detect package manager from lockfiles
	const packageManager = detectPackageManager();
	const inMonorepo = isMonorepo();
	const hasTurbo = hasTurboConfig();

	// Auto-enable turbo for monorepos with turbo.json
	let useTurbo = options.turbo ?? false;
	if (inMonorepo && !useSlim) {
		if (hasTurbo) {
			useTurbo = true;
			logger.log('   Detected monorepo with turbo.json - using turbo prune');
		} else {
			throw new Error(
				'Monorepo detected but turbo.json not found.\n\n' +
					'Docker builds in monorepos require Turborepo for proper dependency isolation.\n\n' +
					'To fix this:\n' +
					'  1. Install turbo: pnpm add -Dw turbo\n' +
					'  2. Create turbo.json in your monorepo root\n' +
					'  3. Run this command again\n\n' +
					'See: https://turbo.build/repo/docs/guides/tools/docker',
			);
		}
	}

	// Get the actual package name from package.json for turbo prune
	let turboPackage = options.turboPackage ?? dockerConfig.imageName;
	if (useTurbo && !options.turboPackage) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const pkg = require(`${process.cwd()}/package.json`);
			if (pkg.name) {
				turboPackage = pkg.name;
				logger.log(`   Turbo package: ${turboPackage}`);
			}
		} catch {
			// Fall back to imageName
		}
	}

	const templateOptions = {
		imageName: dockerConfig.imageName,
		baseImage: dockerConfig.baseImage,
		port: dockerConfig.port,
		healthCheckPath,
		prebuilt: useSlim,
		turbo: useTurbo,
		turboPackage,
		packageManager,
	};

	// Generate Dockerfile
	const dockerfile = useSlim
		? generateSlimDockerfile(templateOptions)
		: generateMultiStageDockerfile(templateOptions);

	const dockerMode = useSlim ? 'slim' : useTurbo ? 'turbo' : 'multi-stage';

	const dockerfilePath = join(dockerDir, 'Dockerfile');
	await writeFile(dockerfilePath, dockerfile);
	logger.log(
		`Generated: .gkm/docker/Dockerfile (${dockerMode}, ${packageManager})`,
	);

	const composePath = await writeConstructsCompose(loadedConfig.workspace);

	// Generate .dockerignore in project root (Docker looks for it there)
	const dockerignore = generateDockerignore();
	const dockerignorePath = join(process.cwd(), '.dockerignore');
	await writeFile(dockerignorePath, dockerignore);
	logger.log('Generated: .dockerignore (project root)');

	// Generate docker-entrypoint.sh
	const entrypoint = generateDockerEntrypoint();
	const entrypointPath = join(dockerDir, 'docker-entrypoint.sh');
	await writeFile(entrypointPath, entrypoint);
	logger.log('Generated: .gkm/docker/docker-entrypoint.sh');

	const result: DockerGeneratedFiles = {
		dockerfile: dockerfilePath,
		dockerCompose: composePath,
		dockerignore: dockerignorePath,
		entrypoint: entrypointPath,
	};

	// Build Docker image if requested
	if (options.build) {
		await buildDockerImage(dockerConfig.imageName, options);
	}

	// Push Docker image if requested
	if (options.push) {
		await pushDockerImage(dockerConfig.imageName, options);
	}

	return result;
}

/**
 * Ensure lockfile exists in the build context
 * For monorepos, copies from workspace root if needed
 * Returns cleanup function if file was copied
 */
function ensureLockfile(cwd: string): (() => void) | null {
	const lockfilePath = findLockfilePath(cwd);

	if (!lockfilePath) {
		logger.warn(
			'\n⚠️  No lockfile found. Docker build may fail or use stale dependencies.',
		);
		return null;
	}

	const lockfileName = basename(lockfilePath);
	const localLockfile = join(cwd, lockfileName);

	// If lockfile exists locally (same directory), nothing to do
	if (lockfilePath === localLockfile) {
		return null;
	}

	logger.log(`   Copying ${lockfileName} from monorepo root...`);
	copyFileSync(lockfilePath, localLockfile);

	// Return cleanup function
	return () => {
		try {
			unlinkSync(localLockfile);
		} catch {
			// Ignore cleanup errors
		}
	};
}

/**
 * Build Docker image
 * Uses BuildKit for cache mount support
 */
async function buildDockerImage(
	imageName: string,
	options: DockerOptions,
): Promise<void> {
	const tag = options.tag ?? 'latest';
	const registry = options.registry;

	// Before anything runs: a ref docker would misread is refused by name.
	const fullImageName = validateImageRef(
		registry ? `${registry}/${imageName}:${tag}` : `${imageName}:${tag}`,
	);

	logger.log(`\n🐳 Building Docker image: ${fullImageName}`);

	const cwd = process.cwd();

	// Ensure lockfile exists (copy from monorepo root if needed)
	const cleanup = ensureLockfile(cwd);

	try {
		// An argument array, so nothing in the ref is read by a shell, and
		// `--tag=` so it cannot be read as a flag.
		await run(
			'docker',
			['build', '--file=.gkm/docker/Dockerfile', `--tag=${fullImageName}`, '.'],
			{
				cwd,
				// BuildKit, for the templates' `RUN --mount=type=cache`.
				env: { ...process.env, DOCKER_BUILDKIT: '1' },
			},
		);
		logger.log(`✅ Docker image built: ${fullImageName}`);
	} catch (error) {
		throw new DockerBuildFailed(fullImageName, error);
	} finally {
		// Clean up copied lockfile
		cleanup?.();
	}
}

/**
 * Push Docker image to registry
 */
async function pushDockerImage(
	imageName: string,
	options: DockerOptions,
): Promise<void> {
	const tag = options.tag ?? 'latest';
	const registry = options.registry;

	if (!registry) {
		throw new PushNeedsRegistry(imageName);
	}

	const fullImageName = validateImageRef(`${registry}/${imageName}:${tag}`);

	logger.log(`\n🚀 Pushing Docker image: ${fullImageName}`);

	try {
		await run('docker', ['push', fullImageName], { cwd: process.cwd() });
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
}

/**
 * Get the package name from package.json in an app directory.
 */
function getAppPackageName(appPath: string): string | undefined {
	try {
		const pkgPath = join(appPath, 'package.json');
		if (!existsSync(pkgPath)) {
			return undefined;
		}
		const content = readFileSync(pkgPath, 'utf-8');
		const pkg = JSON.parse(content);
		return pkg.name;
	} catch {
		return undefined;
	}
}

/**
 * Generate Dockerfiles for all apps in a workspace.
 * @internal Exported for testing
 */
export async function workspaceDockerCommand(
	workspace: NormalizedWorkspace,
	/** What the workspace declares — where a site's public keys come from. */
	manifest?: ConstructManifest,
): Promise<WorkspaceDockerResult> {
	const results: AppDockerResult[] = [];
	const apps = Object.entries(workspace.apps);

	logger.log(`\n🐳 Generating Dockerfiles for workspace: ${workspace.name}`);

	// Create docker output directory
	const dockerDir = join(workspace.root, '.gkm', 'docker');
	await mkdir(dockerDir, { recursive: true });

	// Detect package manager
	const packageManager = detectPackageManager(workspace.root);
	logger.log(`   Package manager: ${packageManager}`);

	// Generate Dockerfile for each app
	for (const [appName, app] of apps) {
		// Mobile apps deploy via their own toolchain (e.g. EAS Build for Expo)
		// — no Docker image is produced.
		if (app.type === 'mobile') {
			logger.log(
				`\n   📱 Skipping Docker for ${appName} (mobile app — deploy via framework toolchain)`,
			);
			continue;
		}

		const appPath = app.path;
		const fullAppPath = join(workspace.root, appPath);

		// Get package name for turbo prune (use package.json name or app name)
		const turboPackage = getAppPackageName(fullAppPath) ?? appName;

		// Determine image name
		const imageName = appName;

		const hasEntry = !!app.entry;
		const buildType = hasEntry ? 'entry' : app.type;
		logger.log(`\n   📄 Generating Dockerfile for ${appName} (${buildType})`);

		let dockerfile: string;

		if (app.type === 'web') {
			dockerfile = siteDockerfile(appName, app, {
				turboPackage,
				packageManager,
				...(manifest ? { manifest } : {}),
			});
		} else if (app.entry) {
			// Backend with custom entry point - use tsdown bundling
			dockerfile = generateEntryDockerfile({
				imageName,
				baseImage: 'node:22-alpine',
				port: app.port,
				appPath,
				entry: app.entry,
				turboPackage,
				packageManager,
				healthCheckPath: '/health',
			});
		} else {
			// Backend with gkm routes - use gkm build
			dockerfile = generateBackendDockerfile({
				imageName,
				baseImage: 'node:22-alpine',
				port: app.port,
				appPath,
				turboPackage,
				packageManager,
				healthCheckPath: '/health',
			});
		}

		// Write Dockerfile with app-specific name
		const dockerfilePath = join(dockerDir, `Dockerfile.${appName}`);
		await writeFile(dockerfilePath, dockerfile);
		logger.log(`      Generated: .gkm/docker/Dockerfile.${appName}`);

		results.push({
			appName,
			type: app.type,
			dockerfile: dockerfilePath,
			imageName,
		});
	}

	// Generate shared .dockerignore
	const dockerignore = generateDockerignore();
	const dockerignorePath = join(workspace.root, '.dockerignore');
	await writeFile(dockerignorePath, dockerignore);
	logger.log(`\n   Generated: .dockerignore (workspace root)`);

	const composePath = await writeConstructsCompose(workspace);

	// Summary
	logger.log(
		`\n✅ Generated ${results.length} Dockerfile(s) + ${COMPOSE_PATH}`,
	);
	logger.log('\n📋 Build commands:');
	for (const result of results) {
		const icon =
			result.type === 'backend' ? '⚙️' : result.type === 'mobile' ? '📱' : '🌐';
		logger.log(
			`   ${icon} docker build -f .gkm/docker/Dockerfile.${result.appName} -t ${result.imageName} .`,
		);
	}
	printRunInstructions(workspace);

	return {
		apps: results,
		dockerCompose: composePath,
		dockerignore: dockerignorePath,
	};
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
		turboPackage: string;
		packageManager: PackageManager;
		manifest?: ConstructManifest;
	},
): string {
	const declared = options.manifest
		? Object.entries(options.manifest).find(
				([id, d]) => d.kind === 'site' && appKey(id) === appName,
			)?.[1]
		: undefined;
	const publicUrlArgs =
		declared?.kind === 'site' && options.manifest
			? Object.keys(publicEnvFor(declared, options.manifest))
			: getPublicUrlArgNames(app);

	const webOpts = {
		imageName: appName,
		baseImage: 'node:22-alpine',
		port: app.port,
		appPath: app.path,
		turboPackage: options.turboPackage,
		packageManager: options.packageManager,
		publicUrlArgs,
	};

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
 * The package name turbo prunes an app by: its package.json's, or its name.
 */
export function appPackageName(root: string, appName: string, path: string) {
	return getAppPackageName(join(root, path)) ?? appName;
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
