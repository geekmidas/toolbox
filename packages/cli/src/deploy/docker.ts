import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { scopedName } from '@geekmidas/manifest';
import { dockerCommand } from '../docker';
import type { DeployResult, DockerDeployConfig } from './types';

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
	_appName?: string,
	buildArgs?: string[],
): Promise<void> {
	logger.log(`\n🔨 Building Docker image: ${imageRef}`);

	// Where the lockfile is no longer decides anything here: the image copies a
	// bundle that is already built, so a monorepo and a standalone app produce
	// the same Dockerfile and the same one-directory build context.
	const cwd = process.cwd();

	// Generate appropriate Dockerfile
	// The bundle already exists: `gkm build` ran before this and produced a
	// self-contained `server.mjs`. So the image copies it rather than rebuilding
	// it, which is both faster and the only version that works from inside the
	// source monorepo — `turbo prune` honours .gitignore, so a sibling package's
	// `dist` never arrives, and rebuilding it in the image means bootstrapping
	// the whole workspace to produce a bundle we are holding.
	logger.log('   Generating Dockerfile for the pre-built bundle...');
	await dockerCommand({ slim: true });

	// Determine build context and Dockerfile path
	// For workspaces with multiple apps, use per-app Dockerfile (Dockerfile.api, etc.)
	// One file, not `Dockerfile.${appName}`: the suffix belonged to the
	// generate-every-app-at-once path, and this generates exactly one Dockerfile
	// for the app being built, immediately above.
	//
	// Absolute, because it is written under the *app* while the build may run
	// from elsewhere — where a relative `.gkm/docker/Dockerfile` resolves to a
	// path that does not exist, and `docker build` says only
	// `lstat .gkm: no such file or directory`.
	const dockerfilePath = join(cwd, '.gkm', 'docker', 'Dockerfile');

	// The app's own directory, because the bundle is the only thing copied and
	// it lives there. A monorepo root context was for the build-inside-the-image
	// path, which this no longer takes.
	const buildCwd = cwd;

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

	// imageName is always set by the caller
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
