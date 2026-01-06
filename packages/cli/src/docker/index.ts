import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCommand } from '../build';
import { loadConfig } from '../config';
import { generateDockerCompose, generateMinimalDockerCompose } from './compose';
import {
  generateDockerEntrypoint,
  generateDockerignore,
  generateMultiStageDockerfile,
  generateSlimDockerfile,
  resolveDockerConfig,
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
  /** Use slim Dockerfile (assumes pre-built bundle exists) */
  slim?: boolean;
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

  // Check if production build exists
  const serverDir = join(process.cwd(), '.gkm', 'server');
  const distDir = join(serverDir, 'dist');
  const hasBuild = existsSync(join(distDir, 'server.mjs'));

  // If no build exists and not using slim, trigger a production build
  if (!hasBuild && !options.slim) {
    logger.log(
      '📦 Production build not found. Running: gkm build --provider server --production',
    );
    await buildCommand({
      provider: 'server',
      production: true,
    });
  }

  // Determine if we should use slim Dockerfile
  const useSlim = options.slim ?? hasBuild;

  // Generate Docker files
  const dockerDir = join(process.cwd(), '.gkm', 'docker');
  await mkdir(dockerDir, { recursive: true });

  const templateOptions = {
    imageName: dockerConfig.imageName,
    baseImage: dockerConfig.baseImage,
    port: dockerConfig.port,
    healthCheckPath,
    prebuilt: useSlim,
  };

  // Generate Dockerfile
  const dockerfile = useSlim
    ? generateSlimDockerfile(templateOptions)
    : generateMultiStageDockerfile(templateOptions);

  const dockerfilePath = join(dockerDir, 'Dockerfile');
  await writeFile(dockerfilePath, dockerfile);
  logger.log(`Generated: .gkm/docker/Dockerfile${useSlim ? ' (slim)' : ''}`);

  // Generate docker-compose.yml
  const composeOptions = {
    imageName: dockerConfig.imageName,
    registry: options.registry ?? dockerConfig.registry,
    port: dockerConfig.port,
    healthCheckPath,
    services: dockerConfig.compose?.services ?? [],
  };

  const dockerCompose =
    composeOptions.services.length > 0
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
    execSync(`docker build -f .gkm/docker/Dockerfile -t ${fullImageName} .`, {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
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
