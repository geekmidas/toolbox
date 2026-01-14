import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types.js';
import {
	detectPackageManager,
	getTurboCommand,
	type AppBuildResult,
} from '../index.js';

describe('Workspace Build Command', () => {
	describe('detectPackageManager', () => {
		let testDir: string;
		let originalCwd: string;

		beforeEach(() => {
			testDir = join(
				tmpdir(),
				`gkm-build-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
			mkdirSync(testDir, { recursive: true });
			originalCwd = process.cwd();
			process.chdir(testDir);
		});

		afterEach(() => {
			process.chdir(originalCwd);
			if (testDir) {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		it('should detect pnpm from lock file', () => {
			writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
			expect(detectPackageManager()).toBe('pnpm');
		});

		it('should detect yarn from lock file', () => {
			writeFileSync(join(testDir, 'yarn.lock'), '');
			expect(detectPackageManager()).toBe('yarn');
		});

		it('should default to npm when no lock file exists', () => {
			expect(detectPackageManager()).toBe('npm');
		});

		it('should prefer pnpm over yarn when both exist', () => {
			writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
			writeFileSync(join(testDir, 'yarn.lock'), '');
			expect(detectPackageManager()).toBe('pnpm');
		});
	});

	describe('getTurboCommand', () => {
		it('should generate pnpm turbo command', () => {
			expect(getTurboCommand('pnpm')).toBe('pnpm exec turbo run build');
		});

		it('should generate yarn turbo command', () => {
			expect(getTurboCommand('yarn')).toBe('yarn turbo run build');
		});

		it('should generate npm turbo command', () => {
			expect(getTurboCommand('npm')).toBe('npx turbo run build');
		});

		it('should add filter argument when provided', () => {
			expect(getTurboCommand('pnpm', 'api')).toBe(
				'pnpm exec turbo run build --filter=api',
			);
		});

		it('should add filter for yarn', () => {
			expect(getTurboCommand('yarn', 'web')).toBe(
				'yarn turbo run build --filter=web',
			);
		});

		it('should add filter for npm', () => {
			expect(getTurboCommand('npm', '@myapp/api')).toBe(
				'npx turbo run build --filter=@myapp/api',
			);
		});
	});

	describe('AppBuildResult type', () => {
		it('should have correct structure for successful build', () => {
			const result: AppBuildResult = {
				appName: 'api',
				type: 'backend',
				success: true,
				outputPath: '/path/to/.gkm',
			};

			expect(result.appName).toBe('api');
			expect(result.type).toBe('backend');
			expect(result.success).toBe(true);
			expect(result.outputPath).toBe('/path/to/.gkm');
			expect(result.error).toBeUndefined();
		});

		it('should have correct structure for failed build', () => {
			const result: AppBuildResult = {
				appName: 'web',
				type: 'frontend',
				success: false,
				error: 'Build failed',
			};

			expect(result.appName).toBe('web');
			expect(result.type).toBe('frontend');
			expect(result.success).toBe(false);
			expect(result.error).toBe('Build failed');
			expect(result.outputPath).toBeUndefined();
		});
	});

	describe('workspace build integration', () => {
		it('should correctly categorize apps by type', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test-workspace',
				root: '/test',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
						routes: './src/**/*.ts',
					},
					auth: {
						type: 'backend',
						path: 'apps/auth',
						port: 3001,
						dependencies: [],
						routes: './src/**/*.ts',
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3002,
						dependencies: ['api', 'auth'],
						framework: 'nextjs',
					},
					admin: {
						type: 'frontend',
						path: 'apps/admin',
						port: 3003,
						dependencies: ['api'],
						framework: 'nextjs',
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			const apps = Object.entries(workspace.apps);
			const backendApps = apps.filter(([, app]) => app.type === 'backend');
			const frontendApps = apps.filter(([, app]) => app.type === 'frontend');

			expect(backendApps).toHaveLength(2);
			expect(frontendApps).toHaveLength(2);
			expect(backendApps.map(([name]) => name)).toContain('api');
			expect(backendApps.map(([name]) => name)).toContain('auth');
			expect(frontendApps.map(([name]) => name)).toContain('web');
			expect(frontendApps.map(([name]) => name)).toContain('admin');
		});

		it('should generate correct output paths for different app types', () => {
			const workspace: NormalizedWorkspace = {
				name: 'test',
				root: '/workspace',
				apps: {
					api: {
						type: 'backend',
						path: 'apps/api',
						port: 3000,
						dependencies: [],
					},
					web: {
						type: 'frontend',
						path: 'apps/web',
						port: 3001,
						dependencies: [],
					},
				},
				services: {},
				deploy: { default: 'dokploy' },
				shared: { packages: [] },
				secrets: {},
			};

			// Test that backend apps output to .gkm
			const backendApp = workspace.apps.api!;
			const backendOutputPath = join(
				workspace.root,
				backendApp.path,
				backendApp.type === 'backend' ? '.gkm' : '.next',
			);
			expect(backendOutputPath).toBe('/workspace/apps/api/.gkm');

			// Test that frontend apps output to .next
			const frontendApp = workspace.apps.web!;
			const frontendOutputPath = join(
				workspace.root,
				frontendApp.path,
				frontendApp.type === 'frontend' ? '.next' : '.gkm',
			);
			expect(frontendOutputPath).toBe('/workspace/apps/web/.next');
		});
	});
});
