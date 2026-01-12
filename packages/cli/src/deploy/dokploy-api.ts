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

		return response.json() as Promise<T>;
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
		return this.post<DokployProjectDetails>('project.one', { projectId });
	}

	/**
	 * Create a new project
	 */
	async createProject(
		name: string,
		description?: string,
	): Promise<DokployProject> {
		return this.post<DokployProject>('project.create', {
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
	async saveApplicationEnv(
		applicationId: string,
		env: string,
	): Promise<void> {
		await this.post('application.saveEnvironment', {
			applicationId,
			env,
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
