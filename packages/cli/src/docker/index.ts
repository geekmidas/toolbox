import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { loadConfig } from '../config';
import { generateDockerCompose, generateMinimalDockerCompose } from './compose';
import {
	detectPackageManager,
	findLockfilePath,
	generateDockerEntrypoint,
	generateDockerignore,
	generateMultiStageDockerfile,
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
): Promise<DockerGeneratedFiles> {
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

	try {
		// Use BuildKit for cache mount support (required for --mount=type=cache)
		execSync(
			`DOCKER_BUILDKIT=1 docker build -f .gkm/docker/Dockerfile -t ${fullImageName} .`,
			{
				cwd: process.cwd(),
				stdio: 'inherit',
				env: { ...process.env, DOCKER_BUILDKIT: '1' },
			},
		);
		logger.log(`✅ Docker image built: ${fullImageName}`);
	} catch (error) {
		throw new Error(
			`Failed to build Docker image: ${error instanceof Error ? error.message : 'Unknown error'}`,
		);
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
