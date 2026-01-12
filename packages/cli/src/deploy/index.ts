import { buildCommand } from '../build/index';
import { loadConfig } from '../config';
import { deployDocker, resolveDockerConfig } from './docker';
import { deployDokploy, validateDokployConfig } from './dokploy';
import type { DeployOptions, DeployProvider, DeployResult } from './types';

const logger = console;

/**
 * Generate image tag from stage and timestamp
 */
function generateTag(stage: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	return `${stage}-${timestamp}`;
}

/**
 * Main deploy command
 */
export async function deployCommand(
	options: DeployOptions,
): Promise<DeployResult> {
	const { provider, stage, tag, skipPush, skipBuild } = options;

	logger.log(`\n🚀 Deploying to ${provider}...`);
	logger.log(`   Stage: ${stage}`);

	// Load config
	const config = await loadConfig();

	// Generate tag if not provided
	const imageTag = tag ?? generateTag(stage);
	logger.log(`   Tag: ${imageTag}`);

	// Build for production with secrets injection (unless skipped)
	let masterKey: string | undefined;
	if (!skipBuild) {
		logger.log(`\n📦 Building for production...`);
		const buildResult = await buildCommand({
			provider: 'server',
			production: true,
			stage,
		});
		masterKey = buildResult.masterKey;
	} else {
		logger.log(`\n⏭️  Skipping build (--skip-build)`);
	}

	// Resolve docker config for image reference
	const dockerConfig = resolveDockerConfig(config);
	const imageName = dockerConfig.imageName ?? 'app';
	const registry = dockerConfig.registry;
	const imageRef = registry
		? `${registry}/${imageName}:${imageTag}`
		: `${imageName}:${imageTag}`;

	// Deploy based on provider
	let result: DeployResult;

	switch (provider) {
		case 'docker': {
			result = await deployDocker({
				stage,
				tag: imageTag,
				skipPush,
				masterKey,
				config: dockerConfig,
			});
			break;
		}

		case 'dokploy': {
			// Validate Dokploy config
			const dokployConfigRaw = config.providers?.dokploy;
			if (typeof dokployConfigRaw === 'boolean' || !dokployConfigRaw) {
				throw new Error(
					'Dokploy provider requires configuration.\n' +
						'Configure in gkm.config.ts:\n' +
						'  providers: {\n' +
						'    dokploy: {\n' +
						"      endpoint: 'https://dokploy.example.com',\n" +
						"      projectId: 'proj_xxx',\n" +
						"      applicationId: 'app_xxx',\n" +
						'    },\n' +
						'  }',
				);
			}

			// Validate required fields (throws if missing)
			validateDokployConfig(dokployConfigRaw);
			const dokployConfig = dokployConfigRaw;

			// First build and push the Docker image
			await deployDocker({
				stage,
				tag: imageTag,
				skipPush: false, // Dokploy needs the image in registry
				masterKey,
				config: {
					registry: dokployConfig.registry ?? dockerConfig.registry,
					imageName: dockerConfig.imageName,
				},
			});

			// Then trigger Dokploy deployment
			result = await deployDokploy({
				stage,
				tag: imageTag,
				imageRef,
				masterKey,
				config: dokployConfig,
			});
			break;
		}

		case 'aws-lambda': {
			logger.log('\n⚠️  AWS Lambda deployment is not yet implemented.');
			logger.log('   Use SST or AWS CDK for Lambda deployments.');
			result = { imageRef, masterKey };
			break;
		}

		default: {
			throw new Error(
				`Unknown deploy provider: ${provider}\n` +
					'Supported providers: docker, dokploy, aws-lambda',
			);
		}
	}

	logger.log('\n✅ Deployment complete!');

	return result;
}

export type { DeployOptions, DeployProvider, DeployResult };
