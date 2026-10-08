import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { DockerBuildFailed, DockerPushFailed, dockerCommand } from '../docker';
import { validateImageRef } from '../docker/imageRef';
import { output } from '../output';
import { dockerfileOf } from '../reconcile/apps.js';
import { type RunOptions, run, runOutput } from '../run';
import { keyFingerprint } from '../secrets/encryption';
import type { DockerDeployConfig, DockerDeployResult } from './types';

// Through `output`, so a deploy run hears its own build's progress.
const logger = output;

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
	/**
	 * The project root: where `gkm docker` generates, and the build context.
	 * Defaults to the process's working directory, which is only the
	 * project's when the CLI was started in it.
	 */
	cwd?: string;
	/**
	 * The app's path under `cwd`, as gkm.config.ts gives it. The image is
	 * built from the Dockerfile `gkm docker` writes for it — one per app in a
	 * workspace (`.gkm/docker/Dockerfile.<app>`), the one for a project
	 * whose app is the root (`.gkm/docker/Dockerfile`). Defaults to `.`.
	 */
	appPath?: string;
	/**
	 * The Dockerfile, relative to `cwd`, when it is not the app's — a
	 * worker's, which `gkm docker` writes as `.gkm/docker/Dockerfile.<worker>`.
	 */
	dockerfile?: string;
	/** Stops the build or push: the child is killed. */
	signal?: AbortSignal;
	/**
	 * Where docker's own output goes. A deploy writing JSON to stdout sends it
	 * to stderr instead. Defaults to the terminal.
	 */
	stdio?: RunOptions['stdio'];
}

/** Where and how docker runs for one image. */
interface DockerRun {
	cwd: string;
	/** The Dockerfile, absolute. */
	dockerfile: string;
	signal?: AbortSignal;
	stdio?: RunOptions['stdio'];
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
 * The build arg that names which credentials an image embeds: a hash of the
 * ciphertext, which is not a secret. A BuildKit secret is no part of the
 * build cache's key, so without it a rebuild with credentials encrypted under
 * a new key would reuse the layer that embedded the old ones.
 */
export function credentialsBuildArg(credentials: BuildCredentials): string {
	const id = createHash('sha256')
		.update(`${credentials.encrypted}\n${credentials.iv}`)
		.digest('hex')
		.slice(0, 16);
	return `GKM_CIPHERTEXT_HASH=${id}`;
}

/** The secret file's content: ciphertext, then IV, one per line. */
export function credentialsFileContent(credentials: BuildCredentials): string {
	return `${credentials.encrypted}\n${credentials.iv}\n`;
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
	await writeFile(path, credentialsFileContent(credentials), {
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
	buildArgs: string[] | undefined,
	credentials: BuildCredentials | undefined,
	{ cwd, dockerfile, signal, stdio }: DockerRun,
): Promise<void> {
	logger.log(`\n🔨 Building Docker image: ${imageRef}`);

	// Every app's Dockerfile, as `gkm docker` writes it: the image prunes the
	// build root to the app's slice, installs it and builds it — workspace
	// packages, the bundle, a site's assets — inside Docker. Nothing the host
	// built reaches it.
	logger.log('   Generating Dockerfile...');
	const { buildRoot } = await dockerCommand({ cwd });

	// Relative to the build root, which is the context: absolute paths resolve
	// wherever the deploy was started, and the build runs from the root.
	const dockerfilePath = relative(buildRoot, dockerfile);

	const secret = credentials
		? await writeCredentialsFile(credentials)
		: undefined;

	try {
		// The build root is the context: the package manager's root, which a
		// workspace's Dockerfiles prune from.
		await run(
			'docker',
			dockerBuildArgs({
				dockerfilePath,
				imageRef,
				buildArgs: [
					...(buildArgs ?? []),
					...(credentials ? [credentialsBuildArg(credentials)] : []),
				],
				credentialsFile: secret?.path,
			}),
			{
				cwd: buildRoot,
				// BuildKit, for `--secret` and `RUN --mount`.
				env: { ...process.env, DOCKER_BUILDKIT: '1' },
				...(signal ? { signal } : {}),
				...(stdio ? { stdio } : {}),
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
async function pushImage(
	imageRef: string,
	{ cwd, signal, stdio }: DockerRun,
): Promise<void> {
	logger.log(`\n☁️  Pushing image: ${imageRef}`);

	try {
		await run('docker', ['push', imageRef], {
			cwd,
			...(signal ? { signal } : {}),
			...(stdio ? { stdio } : {}),
		});
		logger.log(`✅ Image pushed: ${imageRef}`);
	} catch (error) {
		throw new DockerPushFailed(imageRef, error);
	}
}

/**
 * The digest the registry gave a pushed image, `sha256:…`.
 *
 * A tag can be pushed over — by the next deploy, or by anything else that
 * shares the repository — and the digest is what says which image a stage
 * actually ran. `RepoDigests` has one entry per repository the image was
 * pushed to, so the one for this ref's repository is picked by name.
 *
 * @internal Exported for testing
 */
export async function pushedDigest(
	imageRef: string,
	{ cwd, signal }: Pick<DockerRun, 'cwd' | 'signal'> = { cwd: process.cwd() },
): Promise<string | undefined> {
	const repository = imageRef.split('@')[0]!.replace(/:[\w][\w.-]*$/, '');
	const output = await runOutput(
		'docker',
		['image', 'inspect', '--format={{json .RepoDigests}}', imageRef],
		{ cwd, ...(signal ? { signal } : {}) },
	);

	let digests: unknown;
	try {
		digests = JSON.parse(output.trim() || '[]');
	} catch {
		return undefined;
	}
	if (!Array.isArray(digests)) return undefined;

	const match = digests.find(
		(entry): entry is string =>
			typeof entry === 'string' && entry.startsWith(`${repository}@`),
	);
	return match?.slice(repository.length + 1);
}

/**
 * Deploy using Docker (build and optionally push image)
 */
export async function deployDocker(
	options: DockerDeployOptions,
): Promise<DockerDeployResult> {
	const { stage, tag, skipPush, masterKey, config, buildArgs, credentials } =
		options;

	// imageName is always set by the caller
	const imageName = config.imageName!;
	// Before anything runs: a ref docker would misread is refused by name.
	const imageRef = validateImageRef(
		getImageRef(config.registry, imageName, tag),
	);

	const cwd = options.cwd ?? process.cwd();
	const docker: DockerRun = {
		cwd,
		dockerfile: join(
			cwd,
			options.dockerfile ??
				dockerfileOf(config.appName ?? imageName, options.appPath ?? '.'),
		),
		...(options.signal ? { signal: options.signal } : {}),
		...(options.stdio ? { stdio: options.stdio } : {}),
	};

	await buildImage(imageRef, buildArgs, credentials, docker);

	// Push to registry if not skipped
	let digest: string | undefined;
	if (!skipPush) {
		if (!config.registry) {
			logger.warn(
				'\n⚠️  No registry configured. Use --skip-push or configure docker.registry in gkm.config.ts',
			);
		} else {
			await pushImage(imageRef, docker);
			digest = await pushedDigest(imageRef, docker);
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
		...(digest ? { digest } : {}),
		masterKey,
	};
}
