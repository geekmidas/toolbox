import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initCommand } from '../index.js';

describe('initCommand', () => {
	let tempDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `cli-init-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
		originalCwd = process.cwd();
		process.chdir(tempDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await rm(tempDir, { recursive: true, force: true });
	});

	describe('non-monorepo', () => {
		it('should create project with minimal template', async () => {
			await initCommand('my-api', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
			});

			const projectDir = join(tempDir, 'my-api');
			expect(existsSync(projectDir)).toBe(true);
			expect(existsSync(join(projectDir, 'package.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'gkm.config.ts'))).toBe(true);
			expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'biome.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'turbo.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'docker-compose.yml'))).toBe(true);
			// Secrets are now encrypted instead of .env files
			expect(
				existsSync(join(projectDir, '.gkm/secrets/development.json')),
			).toBe(true);
			expect(existsSync(join(projectDir, '.gitignore'))).toBe(true);
			expect(existsSync(join(projectDir, 'src/config/env.ts'))).toBe(true);
			expect(existsSync(join(projectDir, 'src/config/logger.ts'))).toBe(true);
			expect(existsSync(join(projectDir, 'src/endpoints/health.ts'))).toBe(
				true,
			);
		});

		it('should create package.json with correct content', async () => {
			await initCommand('my-api', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
			});

			const pkgPath = join(tempDir, 'my-api', 'package.json');
			const content = await readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(content);

			expect(pkg.name).toBe('my-api');
			expect(pkg.type).toBe('module');
			expect(pkg.dependencies['@geekmidas/constructs']).toMatch(/^~/);
			expect(pkg.dependencies['@geekmidas/telescope']).toMatch(/^~/);
			expect(pkg.dependencies.zod).toMatch(/^~/);
			expect(pkg.devDependencies['@biomejs/biome']).toBeDefined();
			expect(pkg.devDependencies.turbo).toBeDefined();
			expect(pkg.scripts.dev).toBe('gkm dev');
			expect(pkg.scripts.lint).toBe('biome lint .');
		});

		it('should create gkm.config.ts with telescope when enabled', async () => {
			await initCommand('my-api', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
			});

			const configPath = join(tempDir, 'my-api', 'gkm.config.ts');
			const content = await readFile(configPath, 'utf-8');

			expect(content).toContain("routes: './src/endpoints/**/*.ts'");
			expect(content).toContain('telescope');
			expect(content).toContain('/__telescope');
		});

		it('should create api template with user endpoints', async () => {
			await initCommand('my-api', {
				template: 'api',
				yes: true,
				skipInstall: true,
			});

			const projectDir = join(tempDir, 'my-api');
			expect(existsSync(join(projectDir, 'src/endpoints/users/list.ts'))).toBe(
				true,
			);
			expect(existsSync(join(projectDir, 'src/endpoints/users/get.ts'))).toBe(
				true,
			);
			expect(existsSync(join(projectDir, 'src/services/database.ts'))).toBe(
				true,
			);
		});

		it('should create serverless template with functions', async () => {
			await initCommand('my-api', {
				template: 'serverless',
				yes: true,
				skipInstall: true,
			});

			const projectDir = join(tempDir, 'my-api');
			expect(existsSync(join(projectDir, 'src/functions/hello.ts'))).toBe(true);

			const configPath = join(projectDir, 'gkm.config.ts');
			const content = await readFile(configPath, 'utf-8');
			expect(content).toContain('functions');
		});

		it('should create worker template with crons and subscribers', async () => {
			await initCommand('my-api', {
				template: 'worker',
				yes: true,
				skipInstall: true,
			});

			const projectDir = join(tempDir, 'my-api');
			expect(existsSync(join(projectDir, 'src/crons/cleanup.ts'))).toBe(true);
			expect(
				existsSync(join(projectDir, 'src/subscribers/user-events.ts')),
			).toBe(true);
			expect(existsSync(join(projectDir, 'src/events/types.ts'))).toBe(true);

			const configPath = join(projectDir, 'gkm.config.ts');
			const content = await readFile(configPath, 'utf-8');
			expect(content).toContain('crons');
			expect(content).toContain('subscribers');
		});
	});

	describe('monorepo', () => {
		it('should create monorepo structure', async () => {
			await initCommand('my-monorepo', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
				monorepo: true,
				apiPath: 'apps/api',
			});

			const projectDir = join(tempDir, 'my-monorepo');

			// Root files
			expect(existsSync(join(projectDir, 'package.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'pnpm-workspace.yaml'))).toBe(true);
			expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'biome.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'turbo.json'))).toBe(true);
			expect(existsSync(join(projectDir, '.gitignore'))).toBe(true);

			// API app files
			expect(existsSync(join(projectDir, 'apps/api/package.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'apps/api/gkm.config.ts'))).toBe(true);
			expect(existsSync(join(projectDir, 'apps/api/tsconfig.json'))).toBe(true);
			expect(
				existsSync(join(projectDir, 'apps/api/src/endpoints/health.ts')),
			).toBe(true);

			// Models package
			expect(existsSync(join(projectDir, 'packages/models/package.json'))).toBe(
				true,
			);
			expect(
				existsSync(join(projectDir, 'packages/models/tsconfig.json')),
			).toBe(true);
			expect(existsSync(join(projectDir, 'packages/models/src/common.ts'))).toBe(
				true,
			);
			expect(existsSync(join(projectDir, 'packages/models/src/user.ts'))).toBe(
				true,
			);
		});

		it('should create root package.json with turbo scripts', async () => {
			await initCommand('my-monorepo', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
				monorepo: true,
				apiPath: 'apps/api',
			});

			const pkgPath = join(tempDir, 'my-monorepo', 'package.json');
			const content = await readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(content);

			expect(pkg.name).toBe('my-monorepo');
			expect(pkg.scripts.dev).toBe('turbo dev');
			expect(pkg.scripts.build).toBe('turbo build');
			expect(pkg.scripts.lint).toBe('biome lint .');
			expect(pkg.devDependencies['@biomejs/biome']).toBeDefined();
			expect(pkg.devDependencies.turbo).toBeDefined();
		});

		it('should create API package.json with models dependency', async () => {
			await initCommand('my-monorepo', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
				monorepo: true,
				apiPath: 'apps/api',
			});

			const pkgPath = join(tempDir, 'my-monorepo', 'apps/api/package.json');
			const content = await readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(content);

			expect(pkg.name).toBe('@my-monorepo/api');
			expect(pkg.dependencies['@my-monorepo/models']).toBe('workspace:*');
			expect(pkg.dependencies.zod).toBeUndefined(); // zod is in models
			expect(pkg.devDependencies['@biomejs/biome']).toBeUndefined(); // at root
			expect(pkg.devDependencies.turbo).toBeUndefined(); // at root
		});

		it('should create API tsconfig with paths', async () => {
			await initCommand('my-monorepo', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
				monorepo: true,
				apiPath: 'apps/api',
			});

			const tsConfigPath = join(
				tempDir,
				'my-monorepo',
				'apps/api/tsconfig.json',
			);
			const content = await readFile(tsConfigPath, 'utf-8');
			const config = JSON.parse(content);

			expect(config.extends).toBe('../../tsconfig.json');
			expect(config.compilerOptions.paths['@my-monorepo/*']).toEqual([
				'../../packages/*/src',
			]);
		});

		it('should create models package with zod schemas', async () => {
			await initCommand('my-monorepo', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
				monorepo: true,
				apiPath: 'apps/api',
			});

			const pkgPath = join(
				tempDir,
				'my-monorepo',
				'packages/models/package.json',
			);
			const content = await readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(content);

			expect(pkg.name).toBe('@my-monorepo/models');
			expect(pkg.dependencies.zod).toBeDefined();

			const userPath = join(
				tempDir,
				'my-monorepo',
				'packages/models/src/user.ts',
			);
			const userContent = await readFile(userPath, 'utf-8');
			expect(userContent).toContain('UserSchema');
			expect(userContent).toContain('UserResponseSchema');

			const commonPath = join(
				tempDir,
				'my-monorepo',
				'packages/models/src/common.ts',
			);
			const commonContent = await readFile(commonPath, 'utf-8');
			expect(commonContent).toContain('PaginationSchema');
			expect(commonContent).toContain('IdSchema');
		});

		it('should support custom API path', async () => {
			await initCommand('my-monorepo', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
				monorepo: true,
				apiPath: 'services/backend',
			});

			const projectDir = join(tempDir, 'my-monorepo');
			expect(
				existsSync(join(projectDir, 'services/backend/package.json')),
			).toBe(true);
			expect(
				existsSync(join(projectDir, 'services/backend/gkm.config.ts')),
			).toBe(true);

			const pkgPath = join(projectDir, 'services/backend/package.json');
			const content = await readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(content);
			expect(pkg.name).toBe('@my-monorepo/backend');
		});
	});

	describe('fullstack template', () => {
		it('should create monorepo with api and web apps', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const projectDir = join(tempDir, 'my-fullstack');

			// Root files
			expect(existsSync(join(projectDir, 'package.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'pnpm-workspace.yaml'))).toBe(true);
			expect(existsSync(join(projectDir, 'tsconfig.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'biome.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'turbo.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'gkm.config.ts'))).toBe(true);

			// API app files
			expect(existsSync(join(projectDir, 'apps/api/package.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'apps/api/tsconfig.json'))).toBe(true);
			expect(
				existsSync(join(projectDir, 'apps/api/src/endpoints/health.ts')),
			).toBe(true);

			// Web app files
			expect(existsSync(join(projectDir, 'apps/web/package.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'apps/web/next.config.ts'))).toBe(
				true,
			);
			expect(existsSync(join(projectDir, 'apps/web/tsconfig.json'))).toBe(true);
			expect(existsSync(join(projectDir, 'apps/web/src/app/layout.tsx'))).toBe(
				true,
			);
			expect(existsSync(join(projectDir, 'apps/web/src/app/page.tsx'))).toBe(
				true,
			);

			// Models package
			expect(existsSync(join(projectDir, 'packages/models/package.json'))).toBe(
				true,
			);
		});

		it('should create workspace config with defineWorkspace', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const configPath = join(tempDir, 'my-fullstack', 'gkm.config.ts');
			const content = await readFile(configPath, 'utf-8');

			expect(content).toContain('import { defineWorkspace }');
			expect(content).toContain("name: 'my-fullstack'");
			expect(content).toContain("type: 'backend'");
			expect(content).toContain("path: 'apps/api'");
			expect(content).toContain("type: 'frontend'");
			expect(content).toContain("framework: 'nextjs'");
			expect(content).toContain("path: 'apps/web'");
			expect(content).toContain("packages: ['packages/*']");
		});

		it('should create root package.json with gkm commands', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const pkgPath = join(tempDir, 'my-fullstack', 'package.json');
			const content = await readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(content);

			expect(pkg.scripts.dev).toBe('gkm dev');
			expect(pkg.scripts.build).toBe('gkm build');
			expect(pkg.devDependencies['@geekmidas/cli']).toBeDefined();
		});

		it('should create Next.js web app with models dependency', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const pkgPath = join(tempDir, 'my-fullstack', 'apps/web/package.json');
			const content = await readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(content);

			expect(pkg.name).toBe('@my-fullstack/web');
			expect(pkg.dependencies['@my-fullstack/models']).toBe('workspace:*');
			expect(pkg.dependencies.next).toBeDefined();
			expect(pkg.dependencies.react).toBeDefined();
			expect(pkg.scripts.dev).toContain('next dev');
		});

		it('should include services config in workspace', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const configPath = join(tempDir, 'my-fullstack', 'gkm.config.ts');
			const content = await readFile(configPath, 'utf-8');

			expect(content).toContain('services:');
			expect(content).toContain('db: true');
			expect(content).toContain('cache: true');
			expect(content).toContain('mail: true');
		});

		it('should include deploy config for dokploy', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const configPath = join(tempDir, 'my-fullstack', 'gkm.config.ts');
			const content = await readFile(configPath, 'utf-8');

			expect(content).toContain('deploy:');
			expect(content).toContain("default: 'dokploy'");

			const pkgPath = join(tempDir, 'my-fullstack', 'package.json');
			const pkgContent = await readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(pkgContent);

			expect(pkg.scripts.deploy).toContain('gkm deploy');
		});

		it('should NOT create app-level gkm.config.ts for api', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			// Config should be at root only, not in apps/api
			expect(existsSync(join(tempDir, 'my-fullstack', 'gkm.config.ts'))).toBe(
				true,
			);
			expect(
				existsSync(join(tempDir, 'my-fullstack', 'apps/api/gkm.config.ts')),
			).toBe(false);
		});
	});

	describe('docker-compose', () => {
		it('should include postgres for database-enabled projects', async () => {
			await initCommand('my-api', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
			});

			const dockerPath = join(tempDir, 'my-api', 'docker-compose.yml');
			const content = await readFile(dockerPath, 'utf-8');
			expect(content).toContain('postgres:16-alpine');
			expect(content).toContain('5432:5432');
		});

		it('should include serverless-redis-http for serverless template', async () => {
			await initCommand('my-api', {
				template: 'serverless',
				yes: true,
				skipInstall: true,
			});

			const dockerPath = join(tempDir, 'my-api', 'docker-compose.yml');
			const content = await readFile(dockerPath, 'utf-8');
			expect(content).toContain('hiett/serverless-redis-http');
		});

		it('should include rabbitmq for worker template', async () => {
			await initCommand('my-api', {
				template: 'worker',
				yes: true,
				skipInstall: true,
			});

			const dockerPath = join(tempDir, 'my-api', 'docker-compose.yml');
			const content = await readFile(dockerPath, 'utf-8');
			expect(content).toContain('rabbitmq:3-management-alpine');
			expect(content).toContain('5672:5672');
			expect(content).toContain('15672:15672');
		});
	});
});
