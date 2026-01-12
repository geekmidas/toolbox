import { execSync } from 'node:child_process';
import type { GkmConfig } from '../types';
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
 */
async function buildImage(imageRef: string): Promise<void> {
	logger.log(`\n🔨 Building Docker image: ${imageRef}`);

	try {
		execSync(
			`DOCKER_BUILDKIT=1 docker build -f .gkm/docker/Dockerfile -t ${imageRef} .`,
			{
				cwd: process.cwd(),
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

	const imageName = config.imageName ?? 'app';
	const imageRef = getImageRef(config.registry, imageName, tag);

	// Build image
	await buildImage(imageRef);

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
 */
export function resolveDockerConfig(config: GkmConfig): DockerDeployConfig {
	return {
		registry: config.docker?.registry,
		imageName: config.docker?.imageName,
	};
}
