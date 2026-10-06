import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scopedName } from '@geekmidas/manifest';
import { DockerBuildFailed, DockerPushFailed, dockerCommand } from '../docker';
import { validateImageRef } from '../docker/imageRef';
import { run } from '../run';
import { keyFingerprint } from '../secrets/encryption';
import type { DeployResult, DockerDeployConfig } from './types';

const logger = console;

/**
 * The id the Dockerfile templates mount the encrypted credentials under:
 * `RUN --mount=type=secret,id=gkm_credentials`.
 */
export const CREDENTIALS_SECRET_ID = 'gkm_credentials';

/** The encrypted payload a backend's image is built with. */
export interface BuildCredentials {
	/** Base64 ciphertext and auth tag. */
	encrypted: string;
	/** Hex IV. */
	iv: string;
}

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
	 *
	 * Only for values that may be public: a build arg is recorded in the image
	 * history. Secrets go through `credentials`.
	 */
	buildArgs?: string[];
	/**
	 * Encrypted credentials, handed to the build as a BuildKit secret — never a
	 * build arg, which `ps`, shell history and `docker history` all keep.
	 */
	credentials?: BuildCredentials;
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
 * The `docker build` argv for an image.
 *
 * One element per value, so nothing in a ref or a build arg is read by a
 * shell, and `--opt=value` rather than `--opt value`, so a value that starts
 * with `-` cannot be taken for one of docker's own flags.
 *
 * @internal Exported for testing
 */
export function dockerBuildArgs(options: {
	dockerfilePath: string;
	imageRef: string;
	buildArgs?: readonly string[];
	/** The file holding the encrypted credentials, if the build gets them. */
	credentialsFile?: string;
}): string[] {
	const { dockerfilePath, imageRef, buildArgs = [], credentialsFile } = options;
	return [
		'build',
		// linux/amd64 is what most cloud servers run.
		'--platform=linux/amd64',
		`--file=${dockerfilePath}`,
		`--tag=${imageRef}`,
		...buildArgs.map((arg) => `--build-arg=${arg}`),
		...(credentialsFile
			? [`--secret=id=${CREDENTIALS_SECRET_ID},src=${credentialsFile}`]
			: []),
		'.',
	];
}

/**
 * Write the encrypted credentials where `docker build --secret` reads them.
 *
 * Two lines — ciphertext, then IV — so a template can split them with `sed`
 * in any base image. Owner-only, in a directory of its own, and the returned
 * cleanup removes both whatever the build did.
 *
 * @internal Exported for testing
 */
export async function writeCredentialsFile(
	credentials: BuildCredentials,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), 'gkm-credentials-'));
	const path = join(dir, CREDENTIALS_SECRET_ID);
	await writeFile(path, `${credentials.encrypted}\n${credentials.iv}\n`, {
		mode: 0o600,
	});
	// `mode` above passes through the umask; this does not.
	await chmod(path, 0o600);
	return {
		path,
		cleanup: () => rm(dir, { recursive: true, force: true }),
	};
}

/**
 * Build Docker image
 * @param imageRef - Full image reference (registry/name:tag)
 * @param buildArgs - Build arguments to pass to docker build
 * @param credentials - Encrypted credentials, passed as a build secret
 */
async function buildImage(
	imageRef: string,
	buildArgs?: string[],
	credentials?: BuildCredentials,
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

	// One file, not `Dockerfile.${appName}`: the suffix belonged to the
	// generate-every-app-at-once path, and this generates exactly one Dockerfile
	// for the app being built, immediately above.
	//
	// Absolute, because it is written under the *app* while the build may run
	// from elsewhere — where a relative `.gkm/docker/Dockerfile` resolves to a
	// path that does not exist, and `docker build` says only
	// `lstat .gkm: no such file or directory`.
	const dockerfilePath = join(cwd, '.gkm', 'docker', 'Dockerfile');

	const secret = credentials
		? await writeCredentialsFile(credentials)
		: undefined;

	try {
		// The app's own directory is the context, because the bundle is the only
		// thing copied and it lives there.
		await run(
			'docker',
			dockerBuildArgs({
				dockerfilePath,
				imageRef,
				buildArgs,
				credentialsFile: secret?.path,
			}),
			{
				cwd,
				// BuildKit, for `--secret` and `RUN --mount`.
				env: { ...process.env, DOCKER_BUILDKIT: '1' },
			},
		);
		logger.log(`✅ Image built: ${imageRef}`);
	} catch (error) {
		throw new DockerBuildFailed(imageRef, error);
	} finally {
		await secret?.cleanup();
	}
}

/**
 * Push Docker image to registry
 */
async function pushImage(imageRef: string): Promise<void> {
	logger.log(`\n☁️  Pushing image: ${imageRef}`);

	try {
		await run('docker', ['push', imageRef], { cwd: process.cwd() });
		logger.log(`✅ Image pushed: ${imageRef}`);
	} catch (error) {
		throw new DockerPushFailed(imageRef, error);
	}
}

/**
 * Deploy using Docker (build and optionally push image)
 */
export async function deployDocker(
	options: DockerDeployOptions,
): Promise<DeployResult> {
	const { stage, tag, skipPush, masterKey, config, buildArgs, credentials } =
		options;

	// imageName is always set by the caller
	const imageName = config.imageName!;
	// Before anything runs: a ref docker would misread is refused by name.
	const imageRef = validateImageRef(
		getImageRef(config.registry, imageName, tag),
	);

	await buildImage(imageRef, buildArgs, credentials);

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

	// Named by its fingerprint, never printed: the key decrypts every secret of
	// the stage, and CI logs and scrollback outlive the deploy.
	if (masterKey) {
		logger.log(
			`\n🔐 Run the container with GKM_MASTER_KEY set to the key with fingerprint ${keyFingerprint(masterKey)}.`,
		);
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
