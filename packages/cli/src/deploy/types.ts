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
}

/** Result from a deployment */
export interface DeployResult {
	/** Docker image reference (if applicable) */
	imageRef?: string;
	/** Ephemeral master key for GKM_MASTER_KEY */
	masterKey?: string;
	/** Deployment ID (for Dokploy) */
	deploymentId?: string;
	/** Deployment URL (if available) */
	url?: string;
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
