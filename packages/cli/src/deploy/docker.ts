import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scopedName } from '@geekmidas/manifest';
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
	/**
	 * Build arguments to pass to docker build.
	 * Format: ['KEY=value', 'KEY2=value2']
	 */
	buildArgs?: string[];
	/**
	 * Public URL argument names for frontend Dockerfile generation.
	 * Used to ensure the Dockerfile declares these as ARG/ENV.
	 */
	publicUrlArgs?: string[];
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
 * @param buildArgs - Build arguments to pass to docker build
 */
async function buildImage(
	imageRef: string,
	appName?: string,
	buildArgs?: string[],
): Promise<void> {
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
	const buildCwd = lockfilePath && (inMonorepo || appName) ? lockfileDir : cwd;
	if (buildCwd !== cwd) {
		logger.log(`   Building from workspace root: ${buildCwd}`);
	}

	// Build the build args string
	const buildArgsString =
		buildArgs && buildArgs.length > 0
			? buildArgs.map((arg) => `--build-arg "${arg}"`).join(' ')
			: '';

	try {
		// Build for linux/amd64 to ensure compatibility with most cloud servers
		const cmd = [
			'DOCKER_BUILDKIT=1 docker build',
			'--platform linux/amd64',
			`-f ${dockerfilePath}`,
			`-t ${imageRef}`,
			buildArgsString,
			'.',
		]
			.filter(Boolean)
			.join(' ');

		execSync(cmd, {
			cwd: buildCwd,
			stdio: 'inherit',
			env: { ...process.env, DOCKER_BUILDKIT: '1' },
		});
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
	const { stage, tag, skipPush, masterKey, config, buildArgs } = options;

	// imageName should always be set by resolveDockerConfig
	const imageName = config.imageName!;
	const imageRef = getImageRef(config.registry, imageName, tag);

	// Build image (pass appName for workspace Dockerfile selection)
	await buildImage(imageRef, config.appName, buildArgs);

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
 * What one application is called on a provider.
 *
 * The same rule the constructs use, through the same `scopedName`: the
 * application beside `production-kitchen-sink-database` is
 * `production-kitchen-sink-api`, not `api`. Both deploy paths call this — the
 * workspace one named its applications by the bare app key, so a project held
 * an `api` and a `web` that every stage would collide on.
 *
 * The app id is dropped when it repeats the project, so a project named for its
 * one application is `production-kitchen-sink` rather than
 * `production-kitchen-sink-kitchen-sink`.
 */
export function applicationName(
	stage: string,
	project: string,
	app: string,
): string {
	return app === project
		? `${stage}-${project}`.toLowerCase()
		: scopedName([stage, project], app);
}

/**
 * Resolve Docker deploy config from gkm config.
 *
 * **`name` is the scope, exactly as it is in an SST config.** `sst.config.ts`
 * declares `name: 'kitchen-sink'` and every physical name is built from
 * `[stage, name]`; this is the same statement in the same place, so a construct
 * carries one name across providers rather than two that happen to match.
 *
 * A package.json name is the fallback, not the source. It used to be the source,
 * which put the *monorepo* name on the Dokploy project and the *package* name on
 * the application — two accidents of directory layout standing in for a
 * decision, neither of them scoped by stage.
 *
 * - `projectName` — the gkm config's `name`. The Dokploy project, and the `app`
 *   half of every scoped name, the way `$app.name` is in SST.
 * - `appName` — the application within it, scoped `{stage}-{name}` by the
 *   shared rule. Dropped to the project alone when the app *is* the project, so
 *   a workspace named for its one app is not `…-kitchen-sink-kitchen-sink`.
 * - `imageName` — the Docker image, which is a different question: an image is
 *   pushed to a registry under a name a human reads, and it carries no stage
 *   because one image is deployed to several.
 */
export function resolveDockerConfig(
	config: GkmConfig,
	stage?: string,
): DockerDeployConfig {
	const projectName =
		config.name ?? getAppNameFromPackageJson() ?? getAppNameFromCwd() ?? 'app';

	const appId = getAppNameFromCwd() ?? projectName;
	const appName =
		stage === undefined ? appId : applicationName(stage, projectName, appId);

	// The image keeps the app's own name: it is what somebody types after
	// `docker pull`, and the registry path already scopes it.
	const imageName = config.docker?.imageName ?? appId;

	return {
		registry: config.docker?.registry,
		imageName,
		projectName,
		appName,
	};
}
