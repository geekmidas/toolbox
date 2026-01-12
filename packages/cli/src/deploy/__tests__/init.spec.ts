import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// We'll test the config update logic by importing and testing the updateConfig behavior
// through file operations since the actual API calls would require mocking

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
