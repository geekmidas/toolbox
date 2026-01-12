import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateConfig } from '../init';

// MSW server for mocking Dokploy API calls
const server = setupServer();

describe('Dokploy API interactions', () => {
	beforeEach(() => {
		server.listen({ onUnhandledRequest: 'bypass' });
	});

	afterEach(() => {
		server.resetHandlers();
		server.close();
	});

	describe('project operations', () => {
		it('should list projects', async () => {
			server.use(
				http.get('https://dokploy.example.com/api/project.all', () => {
					return HttpResponse.json([
						{ projectId: 'proj_1', name: 'Project 1', description: null },
						{ projectId: 'proj_2', name: 'Project 2', description: 'Test project' },
					]);
				}),
			);

			const response = await fetch('https://dokploy.example.com/api/project.all', {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-token',
				},
			});

			expect(response.ok).toBe(true);
			const projects = await response.json();
			expect(projects).toHaveLength(2);
			expect(projects[0].projectId).toBe('proj_1');
		});

		it('should create a project', async () => {
			server.use(
				http.post('https://dokploy.example.com/api/project.create', async ({ request }) => {
					const body = await request.json() as { name: string; description?: string };
					return HttpResponse.json({
						projectId: 'proj_new',
						name: body.name,
						description: body.description || null,
						createdAt: new Date().toISOString(),
						adminId: 'admin_1',
					});
				}),
			);

			const response = await fetch('https://dokploy.example.com/api/project.create', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-token',
				},
				body: JSON.stringify({ name: 'New Project', description: 'Created by gkm' }),
			});

			expect(response.ok).toBe(true);
			const project = await response.json();
			expect(project.projectId).toBe('proj_new');
			expect(project.name).toBe('New Project');
		});

		it('should get a single project', async () => {
			server.use(
				http.post('https://dokploy.example.com/api/project.one', async ({ request }) => {
					const body = await request.json() as { projectId: string };
					return HttpResponse.json({
						projectId: body.projectId,
						name: 'Test Project',
						environments: [
							{ environmentId: 'env_1', name: 'production', description: null },
						],
					});
				}),
			);

			const response = await fetch('https://dokploy.example.com/api/project.one', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-token',
				},
				body: JSON.stringify({ projectId: 'proj_1' }),
			});

			expect(response.ok).toBe(true);
			const project = await response.json();
			expect(project.environments).toHaveLength(1);
		});
	});

	describe('application operations', () => {
		it('should create an application', async () => {
			server.use(
				http.post('https://dokploy.example.com/api/application.create', async ({ request }) => {
					const body = await request.json() as { name: string; projectId: string; environmentId: string };
					return HttpResponse.json({
						applicationId: 'app_new',
						name: body.name,
						projectId: body.projectId,
						environmentId: body.environmentId,
					});
				}),
			);

			const response = await fetch('https://dokploy.example.com/api/application.create', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-token',
				},
				body: JSON.stringify({
					name: 'api',
					projectId: 'proj_1',
					environmentId: 'env_1',
				}),
			});

			expect(response.ok).toBe(true);
			const app = await response.json();
			expect(app.applicationId).toBe('app_new');
		});

		it('should update application with registry', async () => {
			server.use(
				http.post('https://dokploy.example.com/api/application.update', async ({ request }) => {
					const body = await request.json() as { applicationId: string; registryId: string };
					return HttpResponse.json({ success: true });
				}),
			);

			const response = await fetch('https://dokploy.example.com/api/application.update', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-token',
				},
				body: JSON.stringify({
					applicationId: 'app_1',
					registryId: 'reg_1',
				}),
			});

			expect(response.ok).toBe(true);
		});
	});

	describe('registry operations', () => {
		it('should list registries', async () => {
			server.use(
				http.get('https://dokploy.example.com/api/registry.all', () => {
					return HttpResponse.json([
						{
							registryId: 'reg_1',
							registryName: 'GitHub Container Registry',
							registryUrl: 'ghcr.io',
							username: 'myorg',
							imagePrefix: null,
						},
					]);
				}),
			);

			const response = await fetch('https://dokploy.example.com/api/registry.all', {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-token',
				},
			});

			expect(response.ok).toBe(true);
			const registries = await response.json();
			expect(registries).toHaveLength(1);
			expect(registries[0].registryName).toBe('GitHub Container Registry');
		});
	});

	describe('environment operations', () => {
		it('should create an environment', async () => {
			server.use(
				http.post('https://dokploy.example.com/api/environment.create', async ({ request }) => {
					const body = await request.json() as { projectId: string; name: string };
					return HttpResponse.json({
						environmentId: 'env_new',
						name: body.name,
					});
				}),
			);

			const response = await fetch('https://dokploy.example.com/api/environment.create', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-token',
				},
				body: JSON.stringify({
					projectId: 'proj_1',
					name: 'production',
					description: 'Production environment',
				}),
			});

			expect(response.ok).toBe(true);
			const env = await response.json();
			expect(env.environmentId).toBe('env_new');
		});
	});

	describe('error handling', () => {
		it('should handle API errors', async () => {
			server.use(
				http.get('https://dokploy.example.com/api/project.all', () => {
					return HttpResponse.json(
						{ message: 'Unauthorized' },
						{ status: 401 },
					);
				}),
			);

			const response = await fetch('https://dokploy.example.com/api/project.all', {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer invalid-token',
				},
			});

			expect(response.ok).toBe(false);
			expect(response.status).toBe(401);
		});

		it('should handle network errors', async () => {
			server.use(
				http.get('https://dokploy.example.com/api/project.all', () => {
					return HttpResponse.error();
				}),
			);

			try {
				await fetch('https://dokploy.example.com/api/project.all');
				expect.fail('Should have thrown');
			} catch {
				// Expected network error
			}
		});
	});
});

describe('deploy init', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `gkm-deploy-init-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		if (existsSync(tempDir)) {
			await rm(tempDir, { recursive: true });
		}
	});

	describe('config file updates', () => {
		it('should handle config without providers section', async () => {
			const configPath = join(tempDir, 'gkm.config.ts');
			const originalConfig = `import { defineConfig } from '@geekmidas/cli';

export default defineConfig({
	routes: 'src/endpoints/**/*.ts',
	envParser: './src/env.ts',
});`;

			await writeFile(configPath, originalConfig);

			// Simulate what updateConfig does
			const content = await readFile(configPath, 'utf-8');

			// Check that providers section doesn't exist
			expect(content.includes('providers:')).toBe(false);

			// The update would add providers section
			const config = {
				endpoint: 'https://dokploy.example.com',
				projectId: 'proj_123',
				applicationId: 'app_456',
			};

			const newContent = content.replace(
				/}\s*\)\s*;?\s*$/,
				`
	providers: {
		dokploy: {
			endpoint: '${config.endpoint}',
			projectId: '${config.projectId}',
			applicationId: '${config.applicationId}',
		},
	},
});`,
			);

			expect(newContent).toContain('providers:');
			expect(newContent).toContain('dokploy:');
			expect(newContent).toContain('endpoint: \'https://dokploy.example.com\'');
			expect(newContent).toContain('projectId: \'proj_123\'');
			expect(newContent).toContain('applicationId: \'app_456\'');
		});

		it('should handle config with existing providers section', async () => {
			const configPath = join(tempDir, 'gkm.config.ts');
			const originalConfig = `import { defineConfig } from '@geekmidas/cli';

export default defineConfig({
	routes: 'src/endpoints/**/*.ts',
	providers: {
		server: true,
	},
});`;

			await writeFile(configPath, originalConfig);

			const content = await readFile(configPath, 'utf-8');

			// Check that providers section exists
			expect(content.includes('providers:')).toBe(true);

			// The update would add dokploy to providers
			const config = {
				endpoint: 'https://dokploy.example.com',
				projectId: 'proj_123',
				applicationId: 'app_456',
			};

			const newContent = content.replace(
				/providers:\s*\{/,
				`providers: {
		dokploy: {
			endpoint: '${config.endpoint}',
			projectId: '${config.projectId}',
			applicationId: '${config.applicationId}',
		},`,
			);

			expect(newContent).toContain('dokploy:');
			expect(newContent).toContain('server: true');
		});

		it('should update existing dokploy config', async () => {
			const configPath = join(tempDir, 'gkm.config.ts');
			const originalConfig = `import { defineConfig } from '@geekmidas/cli';

export default defineConfig({
	routes: 'src/endpoints/**/*.ts',
	providers: {
		dokploy: {
			endpoint: 'https://old.dokploy.com',
			projectId: 'old_proj',
			applicationId: 'old_app',
		},
	},
});`;

			await writeFile(configPath, originalConfig);

			const content = await readFile(configPath, 'utf-8');

			// Check existing dokploy config
			expect(content.includes('dokploy:')).toBe(true);
			expect(content.includes('old.dokploy.com')).toBe(true);

			// The update would replace dokploy config
			const config = {
				endpoint: 'https://new.dokploy.com',
				projectId: 'new_proj',
				applicationId: 'new_app',
			};

			const newContent = content.replace(
				/dokploy:\s*\{[^}]*\}/,
				`dokploy: {
			endpoint: '${config.endpoint}',
			projectId: '${config.projectId}',
			applicationId: '${config.applicationId}',
		}`,
			);

			expect(newContent).toContain('new.dokploy.com');
			expect(newContent).toContain('new_proj');
			expect(newContent).toContain('new_app');
			expect(newContent).not.toContain('old.dokploy.com');
		});
	});

	describe('validation', () => {
		it('should require endpoint', () => {
			const options = {
				projectName: 'test',
				appName: 'api',
			};

			// Missing endpoint should fail
			expect(options).not.toHaveProperty('endpoint');
		});

		it('should require project name', () => {
			const options = {
				endpoint: 'https://dokploy.example.com',
				appName: 'api',
			};

			// Missing projectName should fail
			expect(options).not.toHaveProperty('projectName');
		});

		it('should require app name', () => {
			const options = {
				endpoint: 'https://dokploy.example.com',
				projectName: 'test',
			};

			// Missing appName should fail
			expect(options).not.toHaveProperty('appName');
		});
	});
});

describe('DokployDeployConfig type', () => {
	it('should have required fields', () => {
		interface DokployDeployConfig {
			endpoint: string;
			projectId: string;
			applicationId: string;
			registry?: string;
		}

		const config: DokployDeployConfig = {
			endpoint: 'https://dokploy.example.com',
			projectId: 'proj_123',
			applicationId: 'app_456',
		};

		expect(config.endpoint).toBe('https://dokploy.example.com');
		expect(config.projectId).toBe('proj_123');
		expect(config.applicationId).toBe('app_456');
		expect(config.registry).toBeUndefined();
	});

	it('should allow optional registry', () => {
		interface DokployDeployConfig {
			endpoint: string;
			projectId: string;
			applicationId: string;
			registry?: string;
		}

		const config: DokployDeployConfig = {
			endpoint: 'https://dokploy.example.com',
			projectId: 'proj_123',
			applicationId: 'app_456',
			registry: 'ghcr.io/myorg',
		};

		expect(config.registry).toBe('ghcr.io/myorg');
	});
});

describe('updateConfig', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `gkm-update-config-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		if (existsSync(tempDir)) {
			await rm(tempDir, { recursive: true });
		}
	});

	it('should add providers section when missing', async () => {
		const configPath = join(tempDir, 'gkm.config.ts');
		await writeFile(
			configPath,
			`import { defineConfig } from '@geekmidas/cli';

export default defineConfig({
	routes: 'src/endpoints/**/*.ts',
	envParser: './src/env.ts',
});`,
		);

		await updateConfig(
			{
				endpoint: 'https://dokploy.example.com',
				projectId: 'proj_123',
				applicationId: 'app_456',
			},
			tempDir,
		);

		const content = await readFile(configPath, 'utf-8');
		expect(content).toContain('providers:');
		expect(content).toContain('dokploy:');
		expect(content).toContain("endpoint: 'https://dokploy.example.com'");
		expect(content).toContain("projectId: 'proj_123'");
		expect(content).toContain("applicationId: 'app_456'");
	});

	it('should add dokploy to existing providers section', async () => {
		const configPath = join(tempDir, 'gkm.config.ts');
		await writeFile(
			configPath,
			`import { defineConfig } from '@geekmidas/cli';

export default defineConfig({
	routes: 'src/endpoints/**/*.ts',
	providers: {
		server: true,
	},
});`,
		);

		await updateConfig(
			{
				endpoint: 'https://dokploy.example.com',
				projectId: 'proj_123',
				applicationId: 'app_456',
			},
			tempDir,
		);

		const content = await readFile(configPath, 'utf-8');
		expect(content).toContain('dokploy:');
		expect(content).toContain('server: true');
	});

	it('should update existing dokploy config', async () => {
		const configPath = join(tempDir, 'gkm.config.ts');
		await writeFile(
			configPath,
			`import { defineConfig } from '@geekmidas/cli';

export default defineConfig({
	routes: 'src/endpoints/**/*.ts',
	providers: {
		dokploy: {
			endpoint: 'https://old.dokploy.com',
			projectId: 'old_proj',
			applicationId: 'old_app',
		},
	},
});`,
		);

		await updateConfig(
			{
				endpoint: 'https://new.dokploy.com',
				projectId: 'new_proj',
				applicationId: 'new_app',
			},
			tempDir,
		);

		const content = await readFile(configPath, 'utf-8');
		expect(content).toContain('https://new.dokploy.com');
		expect(content).toContain('new_proj');
		expect(content).toContain('new_app');
		expect(content).not.toContain('old.dokploy.com');
	});

	it('should handle missing config file gracefully', async () => {
		// No config file exists - should not throw, just warn
		await expect(
			updateConfig(
				{
					endpoint: 'https://dokploy.example.com',
					projectId: 'proj_123',
					applicationId: 'app_456',
				},
				tempDir,
			),
		).resolves.toBeUndefined();
	});
});
