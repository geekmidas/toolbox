/**
 * Centralized Dokploy API client
 *
 * Handles authentication, error handling, and provides typed methods for all Dokploy API endpoints.
 */

export interface DokployApiOptions {
	/** Dokploy server URL (e.g., https://dokploy.example.com) */
	baseUrl: string;
	/** API token for authentication */
	token: string;
}

export interface DokployErrorResponse {
	message?: string;
	issues?: Array<{ message: string }>;
}

export class DokployApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public statusText: string,
		public issues?: Array<{ message: string }>,
	) {
		super(message);
		this.name = 'DokployApiError';
	}
}

/**
 * Dokploy API client
 */
export class DokployApi {
	private baseUrl: string;
	private token: string;

	constructor(options: DokployApiOptions) {
		this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
		this.token = options.token;
	}

	/**
	 * Make a GET request to the Dokploy API
	 */
	async get<T>(endpoint: string): Promise<T> {
		return this.request<T>('GET', endpoint);
	}

	/**
	 * Make a POST request to the Dokploy API
	 */
	async post<T>(endpoint: string, body?: Record<string, unknown>): Promise<T> {
		return this.request<T>('POST', endpoint, body);
	}

	/**
	 * Make a request to the Dokploy API
	 */
	private async request<T>(
		method: 'GET' | 'POST' | 'PUT' | 'DELETE',
		endpoint: string,
		body?: Record<string, unknown>,
	): Promise<T> {
		const url = `${this.baseUrl}/api/${endpoint}`;

		const response = await fetch(url, {
			method,
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.token,
			},
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			let errorMessage = `Dokploy API error: ${response.status} ${response.statusText}`;
			let issues: Array<{ message: string }> | undefined;

			try {
				const errorBody = (await response.json()) as DokployErrorResponse;
				if (errorBody.message) {
					errorMessage = `Dokploy API error: ${errorBody.message}`;
				}
				if (errorBody.issues?.length) {
					issues = errorBody.issues;
					errorMessage += `\n  Issues: ${errorBody.issues.map((i) => i.message).join(', ')}`;
				}
			} catch {
				// Ignore JSON parse errors
			}

			throw new DokployApiError(
				errorMessage,
				response.status,
				response.statusText,
				issues,
			);
		}

		// Handle empty responses (204 No Content or empty body)
		const text = await response.text();
		if (!text || text.trim() === '') {
			return undefined as T;
		}
		return JSON.parse(text) as T;
	}

	/**
	 * Validate the API token by making a test request
	 */
	async validateToken(): Promise<boolean> {
		try {
			await this.get('project.all');
			return true;
		} catch {
			return false;
		}
	}

	// ============================================
	// Project endpoints
	// ============================================

	/**
	 * List all projects
	 */
	async listProjects(): Promise<DokployProject[]> {
		return this.get<DokployProject[]>('project.all');
	}

	/**
	 * Get a single project by ID
	 */
	async getProject(projectId: string): Promise<DokployProjectDetails> {
		return this.get<DokployProjectDetails>(
			`project.one?projectId=${projectId}`,
		);
	}

	/**
	 * Create a new project
	 */
	async createProject(
		name: string,
		description?: string,
	): Promise<{ project: DokployProject; environment: DokployEnvironment }> {
		return this.post<{
			project: DokployProject;
			environment: DokployEnvironment;
		}>('project.create', {
			name,
			description: description ?? `Created by gkm CLI`,
		});
	}

	// ============================================
	// Environment endpoints
	// ============================================

	/**
	 * Create an environment in a project
	 */
	async createEnvironment(
		projectId: string,
		name: string,
		description?: string,
	): Promise<DokployEnvironment> {
		return this.post<DokployEnvironment>('environment.create', {
			projectId,
			name,
			description: description ?? `${name} environment`,
		});
	}

	// ============================================
	// Application endpoints
	// ============================================

	/**
	 * Create a new application
	 */
	async createApplication(
		name: string,
		projectId: string,
		environmentId: string,
	): Promise<DokployApplication> {
		return this.post<DokployApplication>('application.create', {
			name,
			projectId,
			environmentId,
			appName: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
		});
	}

	/**
	 * Update an application
	 */
	async updateApplication(
		applicationId: string,
		updates: Partial<DokployApplicationUpdate>,
	): Promise<void> {
		await this.post('application.update', {
			applicationId,
			...updates,
		});
	}

	/**
	 * Save environment variables for an application
	 */
	async saveApplicationEnv(applicationId: string, env: string): Promise<void> {
		await this.post('application.saveEnvironment', {
			applicationId,
			env,
		});
	}

	/**
	 * Configure application to use Docker provider (pull from registry)
	 *
	 * For private registries, either:
	 * - Use `registryId` if the registry is configured in Dokploy
	 * - Or provide `username`, `password`, and `registryUrl` directly
	 */
	async saveDockerProvider(
		applicationId: string,
		dockerImage: string,
		options?: {
			/** Registry ID in Dokploy (for pre-configured registries) */
			registryId?: string;
			/** Registry username (for direct auth) */
			username?: string;
			/** Registry password (for direct auth) */
			password?: string;
			/** Registry URL (for direct auth, e.g., ghcr.io) */
			registryUrl?: string;
		},
	): Promise<void> {
		await this.post('application.saveDockerProvider', {
			applicationId,
			dockerImage,
			...options,
		});
	}

	/**
	 * Deploy an application
	 */
	async deployApplication(applicationId: string): Promise<void> {
		await this.post('application.deploy', { applicationId });
	}

	// ============================================
	// Registry endpoints
	// ============================================

	/**
	 * List all registries
	 */
	async listRegistries(): Promise<DokployRegistry[]> {
		return this.get<DokployRegistry[]>('registry.all');
	}

	/**
	 * Create a new registry
	 */
	async createRegistry(
		registryName: string,
		registryUrl: string,
		username: string,
		password: string,
		options?: {
			imagePrefix?: string;
		},
	): Promise<DokployRegistry> {
		return this.post<DokployRegistry>('registry.create', {
			registryName,
			registryUrl,
			username,
			password,
			imagePrefix: options?.imagePrefix,
		});
	}

	/**
	 * Get a registry by ID
	 */
	async getRegistry(registryId: string): Promise<DokployRegistry> {
		return this.get<DokployRegistry>(`registry.one?registryId=${registryId}`);
	}

	/**
	 * Update a registry
	 */
	async updateRegistry(
		registryId: string,
		updates: Partial<{
			registryName: string;
			registryUrl: string;
			username: string;
			password: string;
			imagePrefix: string;
		}>,
	): Promise<void> {
		await this.post('registry.update', { registryId, ...updates });
	}

	/**
	 * Delete a registry
	 */
	async deleteRegistry(registryId: string): Promise<void> {
		await this.post('registry.remove', { registryId });
	}

	// ============================================
	// Postgres endpoints
	// ============================================

	/**
	 * Create a new Postgres database
	 */
	async createPostgres(
		name: string,
		projectId: string,
		environmentId: string,
		options?: {
			appName?: string;
			databaseName?: string;
			databaseUser?: string;
			databasePassword?: string;
			dockerImage?: string;
			description?: string;
		},
	): Promise<DokployPostgres> {
		return this.post<DokployPostgres>('postgres.create', {
			name,
			projectId,
			environmentId,
			appName:
				options?.appName ?? name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
			databaseName: options?.databaseName ?? 'app',
			databaseUser: options?.databaseUser ?? 'postgres',
			databasePassword: options?.databasePassword,
			dockerImage: options?.dockerImage ?? 'postgres:16-alpine',
			description: options?.description ?? `Postgres database for ${name}`,
		});
	}

	/**
	 * Get a Postgres database by ID
	 */
	async getPostgres(postgresId: string): Promise<DokployPostgres> {
		return this.get<DokployPostgres>(`postgres.one?postgresId=${postgresId}`);
	}

	/**
	 * Deploy a Postgres database
	 */
	async deployPostgres(postgresId: string): Promise<void> {
		await this.post('postgres.deploy', { postgresId });
	}

	/**
	 * Save environment variables for Postgres
	 */
	async savePostgresEnv(postgresId: string, env: string): Promise<void> {
		await this.post('postgres.saveEnvironment', { postgresId, env });
	}

	/**
	 * Set external port for Postgres (for external access)
	 */
	async savePostgresExternalPort(
		postgresId: string,
		externalPort: number | null,
	): Promise<void> {
		await this.post('postgres.saveExternalPort', { postgresId, externalPort });
	}

	/**
	 * Update Postgres configuration
	 */
	async updatePostgres(
		postgresId: string,
		updates: Partial<DokployPostgresUpdate>,
	): Promise<void> {
		await this.post('postgres.update', { postgresId, ...updates });
	}

	// ============================================
	// Redis endpoints
	// ============================================

	/**
	 * Create a new Redis instance
	 */
	async createRedis(
		name: string,
		projectId: string,
		environmentId: string,
		options?: {
			appName?: string;
			databasePassword?: string;
			dockerImage?: string;
			description?: string;
		},
	): Promise<DokployRedis> {
		return this.post<DokployRedis>('redis.create', {
			name,
			projectId,
			environmentId,
			appName:
				options?.appName ?? name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
			databasePassword: options?.databasePassword,
			dockerImage: options?.dockerImage ?? 'redis:7-alpine',
			description: options?.description ?? `Redis instance for ${name}`,
		});
	}

	/**
	 * Get a Redis instance by ID
	 */
	async getRedis(redisId: string): Promise<DokployRedis> {
		return this.get<DokployRedis>(`redis.one?redisId=${redisId}`);
	}

	/**
	 * Deploy a Redis instance
	 */
	async deployRedis(redisId: string): Promise<void> {
		await this.post('redis.deploy', { redisId });
	}

	/**
	 * Save environment variables for Redis
	 */
	async saveRedisEnv(redisId: string, env: string): Promise<void> {
		await this.post('redis.saveEnvironment', { redisId, env });
	}

	/**
	 * Set external port for Redis (for external access)
	 */
	async saveRedisExternalPort(
		redisId: string,
		externalPort: number | null,
	): Promise<void> {
		await this.post('redis.saveExternalPort', { redisId, externalPort });
	}

	/**
	 * Update Redis configuration
	 */
	async updateRedis(
		redisId: string,
		updates: Partial<DokployRedisUpdate>,
	): Promise<void> {
		await this.post('redis.update', { redisId, ...updates });
	}

	// ============================================
	// Domain endpoints
	// ============================================

	/**
	 * Create a new domain for an application
	 */
	async createDomain(options: DokployDomainCreate): Promise<DokployDomain> {
		return this.post<DokployDomain>(
			'domain.create',
			options as unknown as Record<string, unknown>,
		);
	}

	/**
	 * Update an existing domain
	 */
	async updateDomain(
		domainId: string,
		updates: Partial<DokployDomainCreate>,
	): Promise<void> {
		await this.post('domain.update', { domainId, ...updates });
	}

	/**
	 * Delete a domain
	 */
	async deleteDomain(domainId: string): Promise<void> {
		await this.post('domain.delete', { domainId });
	}

	/**
	 * Get a domain by ID
	 */
	async getDomain(domainId: string): Promise<DokployDomain> {
		return this.get<DokployDomain>(`domain.one?domainId=${domainId}`);
	}

	/**
	 * Get all domains for an application
	 */
	async getDomainsByApplicationId(
		applicationId: string,
	): Promise<DokployDomain[]> {
		return this.get<DokployDomain[]>(
			`domain.byApplicationId?applicationId=${applicationId}`,
		);
	}

	/**
	 * Auto-generate a domain name for an application
	 */
	async generateDomain(
		appName: string,
		serverId?: string,
	): Promise<{ domain: string }> {
		return this.post<{ domain: string }>('domain.generateDomain', {
			appName,
			serverId,
		});
	}
}

// ============================================
// Type definitions for Dokploy API responses
// ============================================

export interface DokployProject {
	projectId: string;
	name: string;
	description: string | null;
	createdAt?: string;
	adminId?: string;
}

export interface DokployEnvironment {
	environmentId: string;
	name: string;
	description: string | null;
}

export interface DokployProjectDetails extends DokployProject {
	environments: DokployEnvironment[];
}

export interface DokployApplication {
	applicationId: string;
	name: string;
	appName: string;
	projectId: string;
	environmentId?: string;
}

export interface DokployApplicationUpdate {
	registryId: string;
	dockerImage: string;
	sourceType: 'docker';
}

export interface DokployRegistry {
	registryId: string;
	registryName: string;
	registryUrl: string;
	username: string;
	imagePrefix: string | null;
}

export interface DokployPostgres {
	postgresId: string;
	name: string;
	appName: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
	dockerImage: string;
	description: string | null;
	projectId: string;
	environmentId: string;
	applicationStatus: 'idle' | 'running' | 'done' | 'error';
	externalPort: number | null;
	createdAt?: string;
}

export interface DokployPostgresUpdate {
	name: string;
	appName: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
	dockerImage: string;
	description: string;
}

export interface DokployRedis {
	redisId: string;
	name: string;
	appName: string;
	databasePassword: string;
	dockerImage: string;
	description: string | null;
	projectId: string;
	environmentId: string;
	applicationStatus: 'idle' | 'running' | 'done' | 'error';
	externalPort: number | null;
	createdAt?: string;
}

export interface DokployRedisUpdate {
	name: string;
	appName: string;
	databasePassword: string;
	dockerImage: string;
	description: string;
}

export type DokployCertificateType = 'letsencrypt' | 'none' | 'custom';
export type DokployDomainType = 'application' | 'compose' | 'preview';

export interface DokployDomainCreate {
	/** Domain hostname (e.g., 'api.example.com') */
	host: string;
	/** URL path (optional, e.g., '/api') */
	path?: string | null;
	/** Container port to route to (1-65535) */
	port?: number | null;
	/** Enable HTTPS */
	https?: boolean;
	/** Associated application ID */
	applicationId?: string | null;
	/** Certificate type for HTTPS */
	certificateType?: DokployCertificateType;
	/** Custom certificate resolver name */
	customCertResolver?: string | null;
	/** Docker Compose service ID */
	composeId?: string | null;
	/** Service name for compose */
	serviceName?: string | null;
	/** Domain type */
	domainType?: DokployDomainType | null;
	/** Preview deployment ID */
	previewDeploymentId?: string | null;
	/** Internal routing path */
	internalPath?: string | null;
	/** Strip path from forwarded requests */
	stripPath?: boolean;
}

export interface DokployDomain extends DokployDomainCreate {
	domainId: string;
	createdAt?: string;
}

/**
 * Create a Dokploy API client from stored credentials or environment
 */
export async function createDokployApi(
	endpoint?: string,
): Promise<DokployApi | null> {
	const { getDokployCredentials } = await import('../auth/credentials');

	// Try environment variable first
	const envToken = process.env.DOKPLOY_API_TOKEN;
	const envEndpoint = endpoint || process.env.DOKPLOY_ENDPOINT;

	if (envToken && envEndpoint) {
		return new DokployApi({ baseUrl: envEndpoint, token: envToken });
	}

	// Fall back to stored credentials
	const creds = await getDokployCredentials();
	if (creds) {
		return new DokployApi({
			baseUrl: endpoint || creds.endpoint,
			token: creds.token,
		});
	}

	return null;
}
