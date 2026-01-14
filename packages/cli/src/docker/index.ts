import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { loadConfig, loadWorkspaceConfig } from '../config';
import type { NormalizedAppConfig, NormalizedWorkspace } from '../workspace/types.js';
import {
	generateDockerCompose,
	generateMinimalDockerCompose,
	generateWorkspaceCompose,
} from './compose';
import {
	detectPackageManager,
	findLockfilePath,
	generateBackendDockerfile,
	generateDockerEntrypoint,
	generateDockerignore,
	generateMultiStageDockerfile,
	generateNextjsDockerfile,
	generateSlimDockerfile,
	hasTurboConfig,
	isMonorepo,
	resolveDockerConfig,
} from './templates';

export {
	detectPackageManager,
	findLockfilePath,
	hasTurboConfig,
	isMonorepo,
} from './templates';

const logger = console;

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
		return workspaceDockerCommand(loadedConfig.workspace, options);
	}

	// Single-app mode - use existing logic
	const config = await loadConfig();
	const dockerConfig = resolveDockerConfig(config);

	// Get health check path from production config
	const serverConfig =
		typeof config.providers?.server === 'object'
			? config.providers.server
			: undefined;
	const healthCheckPath = serverConfig?.production?.healthCheck ?? '/health';

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

	// Generate docker-compose.yml
	const composeOptions = {
		imageName: dockerConfig.imageName,
		registry: options.registry ?? dockerConfig.registry,
		port: dockerConfig.port,
		healthCheckPath,
		services: dockerConfig.compose?.services ?? {},
	};

	// Check if there are any services configured
	const hasServices = Array.isArray(composeOptions.services)
		? composeOptions.services.length > 0
		: Object.keys(composeOptions.services).length > 0;

	const dockerCompose = hasServices
		? generateDockerCompose(composeOptions)
		: generateMinimalDockerCompose(composeOptions);

	const composePath = join(dockerDir, 'docker-compose.yml');
	await writeFile(composePath, dockerCompose);
	logger.log('Generated: .gkm/docker/docker-compose.yml');

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

	const fullImageName = registry
		? `${registry}/${imageName}:${tag}`
		: `${imageName}:${tag}`;

	logger.log(`\n🐳 Building Docker image: ${fullImageName}`);

	const cwd = process.cwd();

	// Ensure lockfile exists (copy from monorepo root if needed)
	const cleanup = ensureLockfile(cwd);

	try {
		// Use BuildKit for cache mount support (required for --mount=type=cache)
		execSync(
			`DOCKER_BUILDKIT=1 docker build -f .gkm/docker/Dockerfile -t ${fullImageName} .`,
			{
				cwd,
				stdio: 'inherit',
				env: { ...process.env, DOCKER_BUILDKIT: '1' },
			},
		);
		logger.log(`✅ Docker image built: ${fullImageName}`);
	} catch (error) {
		throw new Error(
			`Failed to build Docker image: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
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
		throw new Error(
			'Registry is required to push Docker image. Use --registry or configure docker.registry in gkm.config.ts',
		);
	}

	const fullImageName = `${registry}/${imageName}:${tag}`;

	logger.log(`\n🚀 Pushing Docker image: ${fullImageName}`);

	try {
		execSync(`docker push ${fullImageName}`, {
			cwd: process.cwd(),
			stdio: 'inherit',
		});
		logger.log(`✅ Docker image pushed: ${fullImageName}`);
	} catch (error) {
		throw new Error(
			`Failed to push Docker image: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}

/**
 * Result of generating Docker files for a single app in a workspace.
 */
export interface AppDockerResult {
	appName: string;
	type: 'backend' | 'frontend';
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
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const pkg = require(`${appPath}/package.json`);
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
	options: DockerOptions,
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
		const appPath = app.path;
		const fullAppPath = join(workspace.root, appPath);

		// Get package name for turbo prune (use package.json name or app name)
		const turboPackage = getAppPackageName(fullAppPath) ?? appName;

		// Determine image name
		const imageName = appName;

		logger.log(`\n   📄 Generating Dockerfile for ${appName} (${app.type})`);

		let dockerfile: string;

		if (app.type === 'frontend') {
			// Generate Next.js Dockerfile
			dockerfile = generateNextjsDockerfile({
				imageName,
				baseImage: 'node:22-alpine',
				port: app.port,
				appPath,
				turboPackage,
				packageManager,
			});
		} else {
			// Generate backend Dockerfile
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

	// Generate docker-compose.yml for workspace
	const dockerCompose = generateWorkspaceCompose(workspace, {
		registry: options.registry,
	});
	const composePath = join(dockerDir, 'docker-compose.yml');
	await writeFile(composePath, dockerCompose);
	logger.log(`   Generated: .gkm/docker/docker-compose.yml`);

	// Summary
	logger.log(`\n✅ Generated ${results.length} Dockerfile(s) + docker-compose.yml`);
	logger.log('\n📋 Build commands:');
	for (const result of results) {
		const icon = result.type === 'backend' ? '⚙️' : '🌐';
		logger.log(
			`   ${icon} docker build -f .gkm/docker/Dockerfile.${result.appName} -t ${result.imageName} .`,
		);
	}
	logger.log('\n📋 Run all services:');
	logger.log('   docker compose -f .gkm/docker/docker-compose.yml up --build');

	return {
		apps: results,
		dockerCompose: composePath,
		dockerignore: dockerignorePath,
	};
}
