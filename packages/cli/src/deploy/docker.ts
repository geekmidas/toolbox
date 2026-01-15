import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GkmConfig } from '../config';
import { dockerCommand, findLockfilePath } from '../docker';
import type { DeployResult, DockerDeployConfig } from './types';

/**
 * Get app name from package.json in the current working directory
 * Used for Dokploy app/project naming
 */
export function getAppNameFromCwd(): string | undefined {
	const packageJsonPath = join(process.cwd(), 'package.json');

	if (!existsSync(packageJsonPath)) {
		return undefined;
	}

	try {
		const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
		if (pkg.name) {
			// Strip org scope if present (e.g., @myorg/app -> app)
			return pkg.name.replace(/^@[^/]+\//, '');
		}
	} catch {
		// Ignore parse errors
	}

	return undefined;
}

/**
 * Get app name from package.json adjacent to the lockfile (project root)
 * Used for Docker image naming
 */
export function getAppNameFromPackageJson(): string | undefined {
	const cwd = process.cwd();

	// Find the lockfile to determine the project root
	const lockfilePath = findLockfilePath(cwd);
	if (!lockfilePath) {
		return undefined;
	}

	// Use the package.json adjacent to the lockfile
	const projectRoot = dirname(lockfilePath);
	const packageJsonPath = join(projectRoot, 'package.json');

	if (!existsSync(packageJsonPath)) {
		return undefined;
	}

	try {
		const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
		if (pkg.name) {
			// Strip org scope if present (e.g., @myorg/app -> app)
			return pkg.name.replace(/^@[^/]+\//, '');
		}
	} catch {
		// Ignore parse errors
	}

	return undefined;
}

const logger = console;

export interface DockerDeployOptions {
	/** Deployment stage */
	stage: string;
	/** Image tag */
	tag: string;
	/** Skip pushing to registry */
	skipPush?: boolean;
	/** Master key from build */
	masterKey?: string;
	/** Docker config from gkm.config */
	config: DockerDeployConfig;
}

/**
 * Get the full image reference
 */
export function getImageRef(
	registry: string | undefined,
	imageName: string,
	tag: string,
): string {
	if (registry) {
		return `${registry}/${imageName}:${tag}`;
	}
	return `${imageName}:${tag}`;
}

/**
 * Build Docker image
 * @param imageRef - Full image reference (registry/name:tag)
 * @param appName - Name of the app (used for Dockerfile.{appName} in workspaces)
 */
async function buildImage(imageRef: string, appName?: string): Promise<void> {
	logger.log(`\n🔨 Building Docker image: ${imageRef}`);

	const cwd = process.cwd();
	const lockfilePath = findLockfilePath(cwd);
	const lockfileDir = lockfilePath ? dirname(lockfilePath) : cwd;
	const inMonorepo = lockfileDir !== cwd;

	// Generate appropriate Dockerfile
	if (appName || inMonorepo) {
		logger.log('   Generating Dockerfile for monorepo (turbo prune)...');
	} else {
		logger.log('   Generating Dockerfile...');
	}
	await dockerCommand({});

	// Determine build context and Dockerfile path
	// For workspaces with multiple apps, use per-app Dockerfile (Dockerfile.api, etc.)
	const dockerfileSuffix = appName ? `.${appName}` : '';
	const dockerfilePath = `.gkm/docker/Dockerfile${dockerfileSuffix}`;

	// Build from workspace/monorepo root when we have a lockfile elsewhere or appName is provided
	const buildCwd =
		lockfilePath && (inMonorepo || appName) ? lockfileDir : cwd;
	if (buildCwd !== cwd) {
		logger.log(`   Building from workspace root: ${buildCwd}`);
	}

	try {
		// Build for linux/amd64 to ensure compatibility with most cloud servers
		execSync(
			`DOCKER_BUILDKIT=1 docker build --platform linux/amd64 -f ${dockerfilePath} -t ${imageRef} .`,
			{
				cwd: buildCwd,
				stdio: 'inherit',
				env: { ...process.env, DOCKER_BUILDKIT: '1' },
			},
		);
		logger.log(`✅ Image built: ${imageRef}`);
	} catch (error) {
		throw new Error(
			`Failed to build Docker image: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}

/**
 * Push Docker image to registry
 */
async function pushImage(imageRef: string): Promise<void> {
	logger.log(`\n☁️  Pushing image: ${imageRef}`);

	try {
		execSync(`docker push ${imageRef}`, {
			cwd: process.cwd(),
			stdio: 'inherit',
		});
		logger.log(`✅ Image pushed: ${imageRef}`);
	} catch (error) {
		throw new Error(
			`Failed to push Docker image: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
	}
}

/**
 * Deploy using Docker (build and optionally push image)
 */
export async function deployDocker(
	options: DockerDeployOptions,
): Promise<DeployResult> {
	const { stage, tag, skipPush, masterKey, config } = options;

	// imageName should always be set by resolveDockerConfig
	const imageName = config.imageName!;
	const imageRef = getImageRef(config.registry, imageName, tag);

	// Build image (pass appName for workspace Dockerfile selection)
	await buildImage(imageRef, config.appName);

	// Push to registry if not skipped
	if (!skipPush) {
		if (!config.registry) {
			logger.warn(
				'\n⚠️  No registry configured. Use --skip-push or configure docker.registry in gkm.config.ts',
			);
		} else {
			await pushImage(imageRef);
		}
	}

	// Output deployment info
	logger.log('\n✅ Docker deployment ready!');
	logger.log(`\n📋 Deployment details:`);
	logger.log(`   Image: ${imageRef}`);
	logger.log(`   Stage: ${stage}`);

	if (masterKey) {
		logger.log(`\n🔐 Deploy with this environment variable:`);
		logger.log(`   GKM_MASTER_KEY=${masterKey}`);
		logger.log('\n   Example docker run:');
		logger.log(`   docker run -e GKM_MASTER_KEY=${masterKey} ${imageRef}`);
	}

	return {
		imageRef,
		masterKey,
	};
}

/**
 * Resolve Docker deploy config from gkm config
 * - imageName: from config, or cwd package.json, or 'app' (for Docker image)
 * - projectName: from root package.json, or 'app' (for Dokploy project)
 * - appName: from cwd package.json, or projectName (for Dokploy app within project)
 */
export function resolveDockerConfig(config: GkmConfig): DockerDeployConfig {
	// projectName comes from root package.json (monorepo name)
	const projectName = getAppNameFromPackageJson() ?? 'app';

	// appName comes from cwd package.json (the app being deployed)
	const appName = getAppNameFromCwd() ?? projectName;

	// imageName defaults to appName (cwd package.json)
	const imageName = config.docker?.imageName ?? appName;

	return {
		registry: config.docker?.registry,
		imageName,
		projectName,
		appName,
	};
}
