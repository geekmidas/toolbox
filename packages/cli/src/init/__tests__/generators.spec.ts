import { describe, expect, it } from 'vitest';
import { generateConfigFiles } from '../generators/config.js';
import { generateDockerFiles } from '../generators/docker.js';
import { generateEnvFiles } from '../generators/env.js';
import { generateModelsPackage } from '../generators/models.js';
import { generateMonorepoFiles } from '../generators/monorepo.js';
import { generatePackageJson } from '../generators/package.js';
import type { TemplateOptions } from '../templates/index.js';
import { minimalTemplate } from '../templates/minimal.js';
import { serverlessTemplate } from '../templates/serverless.js';
import { workerTemplate } from '../templates/worker.js';

const baseOptions: TemplateOptions = {
	name: 'test-project',
	template: 'minimal',
	telescope: true,
	database: true,
	routeStyle: 'file-based',
	monorepo: false,
	apiPath: '',
};

describe('generatePackageJson', () => {
	it('should generate package.json with correct name', () => {
		const files = generatePackageJson(baseOptions, minimalTemplate);
		expect(files).toHaveLength(1);
		expect(files[0].path).toBe('package.json');

		const pkg = JSON.parse(files[0].content);
		expect(pkg.name).toBe('test-project');
		expect(pkg.type).toBe('module');
		expect(pkg.private).toBe(true);
	});

	it('should include telescope when enabled', () => {
		const files = generatePackageJson(baseOptions, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.dependencies['@geekmidas/telescope']).toBe('workspace:*');
	});

	it('should include database dependencies when enabled', () => {
		const files = generatePackageJson(baseOptions, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.dependencies['@geekmidas/db']).toBe('workspace:*');
		expect(pkg.dependencies.kysely).toBeDefined();
		expect(pkg.dependencies.pg).toBeDefined();
	});

	it('should exclude telescope when disabled', () => {
		const options = { ...baseOptions, telescope: false };
		const files = generatePackageJson(options, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.dependencies['@geekmidas/telescope']).toBeUndefined();
	});

	it('should use workspace:* for @geekmidas packages', () => {
		const files = generatePackageJson(baseOptions, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.dependencies['@geekmidas/constructs']).toBe('workspace:*');
		expect(pkg.dependencies['@geekmidas/envkit']).toBe('workspace:*');
		expect(pkg.dependencies['@geekmidas/logger']).toBe('workspace:*');
	});

	it('should use tilde versions for external packages', () => {
		const files = generatePackageJson(baseOptions, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.dependencies.hono).toMatch(/^~/);
		expect(pkg.dependencies.pino).toMatch(/^~/);
		expect(pkg.devDependencies.typescript).toMatch(/^~/);
	});

	it('should include biome and turbo for non-monorepo', () => {
		const files = generatePackageJson(baseOptions, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.devDependencies['@biomejs/biome']).toBeDefined();
		expect(pkg.devDependencies.turbo).toBeDefined();
		expect(pkg.scripts.lint).toBeDefined();
		expect(pkg.scripts.fmt).toBeDefined();
	});

	it('should exclude biome and turbo for monorepo apps', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generatePackageJson(options, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.devDependencies['@biomejs/biome']).toBeUndefined();
		expect(pkg.devDependencies.turbo).toBeUndefined();
		expect(pkg.scripts.lint).toBeUndefined();
		expect(pkg.scripts.fmt).toBeUndefined();
	});

	it('should include models package for monorepo apps', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generatePackageJson(options, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.dependencies['@test-project/models']).toBe('workspace:*');
		expect(pkg.dependencies.zod).toBeUndefined(); // zod is in models
	});

	it('should use scoped package name for monorepo apps', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generatePackageJson(options, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.name).toBe('@test-project/api');
	});
});

describe('generateConfigFiles', () => {
	it('should generate gkm.config.ts and tsconfig.json for non-monorepo', () => {
		const files = generateConfigFiles(baseOptions, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('gkm.config.ts');
		expect(paths).toContain('tsconfig.json');
		expect(paths).toContain('biome.json');
		expect(paths).toContain('turbo.json');
	});

	it('should only generate gkm.config.ts and tsconfig.json for monorepo', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateConfigFiles(options, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('gkm.config.ts');
		expect(paths).toContain('tsconfig.json');
		expect(paths).not.toContain('biome.json');
		expect(paths).not.toContain('turbo.json');
	});

	it('should include telescope config when enabled', () => {
		const files = generateConfigFiles(baseOptions, minimalTemplate);
		const gkmConfig = files.find((f) => f.path === 'gkm.config.ts');
		expect(gkmConfig?.content).toContain('telescope');
	});

	it('should include functions config for serverless template', () => {
		const options = { ...baseOptions, template: 'serverless' as const };
		const files = generateConfigFiles(options, serverlessTemplate);
		const gkmConfig = files.find((f) => f.path === 'gkm.config.ts');
		expect(gkmConfig?.content).toContain('functions');
	});

	it('should include paths config for monorepo apps', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateConfigFiles(options, minimalTemplate);
		const tsConfig = files.find((f) => f.path === 'tsconfig.json');
		const config = JSON.parse(tsConfig?.content);
		expect(config.extends).toBe('../../tsconfig.json');
		expect(config.compilerOptions.paths).toBeDefined();
		expect(config.compilerOptions.paths['@test-project/*']).toBeDefined();
	});
});

describe('generateEnvFiles', () => {
	it('should generate all env files for non-monorepo', () => {
		const files = generateEnvFiles(baseOptions, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('.env');
		expect(paths).toContain('.env.example');
		expect(paths).toContain('.env.development');
		expect(paths).toContain('.env.test');
		expect(paths).toContain('.gitignore');
	});

	it('should not generate .gitignore for monorepo', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateEnvFiles(options, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).not.toContain('.gitignore');
	});

	it('should include DATABASE_URL when database is enabled', () => {
		const files = generateEnvFiles(baseOptions, minimalTemplate);
		const envFile = files.find((f) => f.path === '.env');
		expect(envFile?.content).toContain('DATABASE_URL');
	});

	it('should include RABBITMQ_URL for worker template', () => {
		const options = { ...baseOptions, template: 'worker' as const };
		const files = generateEnvFiles(options, workerTemplate);
		const envFile = files.find((f) => f.path === '.env');
		expect(envFile?.content).toContain('RABBITMQ_URL');
	});
});

describe('generateDockerFiles', () => {
	it('should generate docker-compose.yml', () => {
		const files = generateDockerFiles(baseOptions, minimalTemplate);
		expect(files).toHaveLength(1);
		expect(files[0].path).toBe('docker-compose.yml');
	});

	it('should include postgres when database is enabled', () => {
		const files = generateDockerFiles(baseOptions, minimalTemplate);
		expect(files[0].content).toContain('postgres');
		expect(files[0].content).toContain('5432');
	});

	it('should include redis', () => {
		const files = generateDockerFiles(baseOptions, minimalTemplate);
		expect(files[0].content).toContain('redis');
		expect(files[0].content).toContain('6379');
	});

	it('should include serverless-redis-http for serverless template', () => {
		const options = { ...baseOptions, template: 'serverless' as const };
		const files = generateDockerFiles(options, serverlessTemplate);
		expect(files[0].content).toContain('hiett/serverless-redis-http');
		expect(files[0].content).toContain('8079');
	});

	it('should include rabbitmq for worker template', () => {
		const options = { ...baseOptions, template: 'worker' as const };
		const files = generateDockerFiles(options, workerTemplate);
		expect(files[0].content).toContain('rabbitmq');
		expect(files[0].content).toContain('5672');
		expect(files[0].content).toContain('15672');
	});
});

describe('generateMonorepoFiles', () => {
	it('should return empty array for non-monorepo', () => {
		const files = generateMonorepoFiles(baseOptions, minimalTemplate);
		expect(files).toHaveLength(0);
	});

	it('should generate root files for monorepo', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateMonorepoFiles(options, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('package.json');
		expect(paths).toContain('pnpm-workspace.yaml');
		expect(paths).toContain('tsconfig.json');
		expect(paths).toContain('biome.json');
		expect(paths).toContain('turbo.json');
		expect(paths).toContain('.gitignore');
	});

	it('should include correct workspace paths', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateMonorepoFiles(options, minimalTemplate);
		const workspace = files.find((f) => f.path === 'pnpm-workspace.yaml');
		expect(workspace?.content).toContain("'apps/*'");
		expect(workspace?.content).toContain("'packages/*'");
	});

	it('should include root scripts', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateMonorepoFiles(options, minimalTemplate);
		const pkgJson = files.find((f) => f.path === 'package.json');
		const pkg = JSON.parse(pkgJson?.content);
		expect(pkg.scripts.dev).toBe('turbo dev');
		expect(pkg.scripts.build).toBe('turbo build');
		expect(pkg.scripts.lint).toBe('biome lint .');
	});
});

describe('generateModelsPackage', () => {
	it('should return empty array for non-monorepo', () => {
		const files = generateModelsPackage(baseOptions);
		expect(files).toHaveLength(0);
	});

	it('should generate models package for monorepo', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateModelsPackage(options);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('packages/models/package.json');
		expect(paths).toContain('packages/models/tsconfig.json');
		expect(paths).toContain('packages/models/src/index.ts');
	});

	it('should use correct package name', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateModelsPackage(options);
		const pkgJson = files.find(
			(f) => f.path === 'packages/models/package.json',
		);
		const pkg = JSON.parse(pkgJson?.content);
		expect(pkg.name).toBe('@test-project/models');
	});

	it('should include zod as dependency', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateModelsPackage(options);
		const pkgJson = files.find(
			(f) => f.path === 'packages/models/package.json',
		);
		const pkg = JSON.parse(pkgJson?.content);
		expect(pkg.dependencies.zod).toBeDefined();
	});

	it('should include example schemas', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateModelsPackage(options);
		const indexTs = files.find(
			(f) => f.path === 'packages/models/src/index.ts',
		);
		expect(indexTs?.content).toContain('userSchema');
		expect(indexTs?.content).toContain('paginationSchema');
		expect(indexTs?.content).toContain("import { z } from 'zod'");
	});

	it('should extend root tsconfig', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateModelsPackage(options);
		const tsConfig = files.find(
			(f) => f.path === 'packages/models/tsconfig.json',
		);
		const config = JSON.parse(tsConfig?.content);
		expect(config.extends).toBe('../../tsconfig.json');
	});
});
