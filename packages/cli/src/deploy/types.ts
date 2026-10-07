import type { ResourceChange } from './events';

/** Supported deploy providers */
export type DeployProvider = 'docker' | 'dokploy' | 'aws-lambda';

/** Options for the deploy command */
export interface DeployOptions {
	/** Deploy provider */
	provider: DeployProvider;
	/** Deployment stage (e.g., 'production', 'staging') */
	stage: string;
	/** Image tag (default: stage-timestamp) */
	tag?: string;
	/** Skip pushing image to registry */
	skipPush?: boolean;
	/** Skip building (use existing build) */
	skipBuild?: boolean;
	/** Specific apps to deploy (workspace mode only, default: all) */
	apps?: string[];
}

/** What building (and pushing) one image produced. */
export interface DockerDeployResult {
	/** Docker image reference (if applicable) */
	imageRef?: string;
	/** The registry's digest for the pushed image, `sha256:…`. */
	digest?: string;
	/**
	 * Ephemeral master key for GKM_MASTER_KEY.
	 *
	 * @deprecated The key decrypts every secret of the stage, and a result is
	 * easily logged or serialised. A deploy already sets it in the container's
	 * runtime environment; read it from there (or from the `master.key` that
	 * `gkm build --stage` writes beside the bundle) rather than from here. It
	 * will be removed.
	 */
	masterKey?: string;
	/** Deployment ID (for Dokploy) */
	deploymentId?: string;
	/** Deployment URL (if available) */
	url?: string;
}

/** Result for a single app deployment in workspace mode */
export interface AppDeployResult {
	/** App name */
	appName: string;
	/** App type */
	type: 'backend' | 'web' | 'mobile';
	/** Whether deployment succeeded */
	success: boolean;
	/** Dokploy application ID */
	applicationId?: string;
	/** Docker image reference */
	imageRef?: string;
	/** The registry's digest for the image, `sha256:…`, once pushed */
	digest?: string;
	/** Deployment URL */
	url?: string;
	/** Error message if failed */
	error?: string;
}

/** Result from workspace deployment */
export interface WorkspaceDeployResult {
	/** Results for each app */
	apps: AppDeployResult[];
	/** Dokploy project ID */
	projectId: string;
	/** Total number of successful deployments */
	successCount: number;
	/** Total number of failed deployments */
	failedCount: number;
}

/**
 * What a deploy did — or, for a dry run, would do. Plain JSON, so it can be
 * written out as is (`gkm deploy --json` ends with it).
 */
export interface DeployResult extends WorkspaceDeployResult {
	stage: string;
	/** `<namespace>/<project>`. */
	identity: string;
	/** The image tag every app was built with. */
	tag: string;
	/** Whether this was a dry run: nothing was created, built or pushed. */
	dryRun: boolean;
	/** Dokploy's environment for the stage; empty when a dry run would create it. */
	environmentId: string;
	/** Apps left out, and why — a mobile app, another deploy target. */
	skipped: { app: string; reason: string }[];
	/** Each deployed app's public URL. */
	urls: Record<string, string>;
	/**
	 * Every resource the run touched, in order: what it applied, or for a dry
	 * run, what it would.
	 */
	changes: ResourceChange[];
}

/** Docker provider configuration */
export interface DockerDeployConfig {
	/** Container registry URL */
	registry?: string;
	/** Image name for Docker (default: from root package.json) */
	imageName?: string;
	/** Project name for Dokploy (default: from root package.json) */
	projectName?: string;
	/** App name within Dokploy project (default: from cwd package.json) */
	appName?: string;
}

/** Dokploy provider configuration */
export interface DokployDeployConfig {
	/** Dokploy API endpoint */
	endpoint: string;
	/** Project ID in Dokploy */
	projectId: string;
	/** Application ID in Dokploy */
	applicationId: string;
	/** Container registry URL (inherits from docker if not set) */
	registry?: string;
	/**
	 * Registry ID in Dokploy (recommended for private registries).
	 * Configure your registry in Dokploy Settings > Docker Registry first.
	 */
	registryId?: string;
	/**
	 * Docker registry credentials (alternative to registryId).
	 * Only needed if not using Dokploy's registry feature.
	 * Can also use env vars: DOCKER_REGISTRY_USERNAME, DOCKER_REGISTRY_PASSWORD
	 */
	registryCredentials?: {
		/** Registry URL (e.g., ghcr.io, docker.io) */
		registryUrl: string;
		/** Registry username */
		username: string;
		/** Registry password or token */
		password: string;
	};
}
