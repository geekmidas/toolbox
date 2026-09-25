import { describe, expect, it } from 'vitest';
import { generateAgentFiles } from '../generators/agents.js';
import { generateConfigFiles } from '../generators/config.js';
import { generateDockerFiles } from '../generators/docker.js';
import { generateEnvFiles } from '../generators/env.js';
import { generateExpoAppFiles } from '../generators/mobile-expo.js';
import { generateModelsPackage } from '../generators/models.js';
import {
	generateMonorepoFiles,
	generateRootConstructs,
} from '../generators/monorepo.js';
import { generatePackageJson } from '../generators/package.js';
import { generateTestFiles } from '../generators/test.js';
import { generateUiPackageFiles } from '../generators/ui.js';
import { generateTanStackWebFiles } from '../generators/web-tanstack.js';
import { apiTemplate } from '../templates/api.js';
import type { TemplateOptions } from '../templates/index.js';
import { minimalTemplate } from '../templates/minimal.js';
import { serverlessTemplate } from '../templates/serverless.js';
import { workerTemplate } from '../templates/worker.js';

const baseOptions: TemplateOptions = {
	name: 'test-project',
	template: 'minimal',
	telescope: true,
	database: true,
	studio: true,
	loggerType: 'pino',
	routesStructure: 'centralized-endpoints',
	monorepo: false,
	apiPath: '',
	packageManager: 'pnpm',
	deployTarget: 'dokploy',
	services: { db: true, cache: true, mail: false, storage: false },
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
		expect(pkg.dependencies['@geekmidas/telescope']).toMatch(/^~/);
	});

	it('should include database dependencies when enabled', () => {
		const files = generatePackageJson(baseOptions, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.dependencies['@geekmidas/db']).toMatch(/^~/);
		expect(pkg.dependencies.kysely).toBeDefined();
		expect(pkg.dependencies.pg).toBeDefined();
	});

	it('should exclude telescope when disabled', () => {
		const options = { ...baseOptions, telescope: false };
		const files = generatePackageJson(options, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.dependencies['@geekmidas/telescope']).toBeUndefined();
	});

	it('should use tilde versions for @geekmidas packages', () => {
		const files = generatePackageJson(baseOptions, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.dependencies['@geekmidas/constructs']).toMatch(/^~/);
		expect(pkg.dependencies['@geekmidas/envkit']).toMatch(/^~/);
		expect(pkg.dependencies['@geekmidas/logger']).toMatch(/^~/);
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
		expect(tsConfig).toBeDefined();
		const config = JSON.parse(tsConfig!.content);
		expect(config.extends).toBe('../../tsconfig.json');
		expect(config.compilerOptions.paths).toBeDefined();
		expect(config.compilerOptions.paths['@test-project/*']).toBeDefined();
	});
});

describe('generateEnvFiles', () => {
	it('should only generate .gitignore for non-monorepo', () => {
		// .env files are no longer generated - secrets are encrypted instead
		const files = generateEnvFiles(baseOptions, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('.gitignore');
		expect(paths).not.toContain('.env');
		expect(paths).not.toContain('.env.example');
		expect(paths).not.toContain('.env.development');
		expect(paths).not.toContain('.env.test');
	});

	it('should not generate any files for monorepo (gitignore at root)', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateEnvFiles(options, minimalTemplate);
		expect(files).toHaveLength(0);
	});

	it('should include .gkm in gitignore', () => {
		const files = generateEnvFiles(baseOptions, minimalTemplate);
		const gitignore = files.find((f) => f.path === '.gitignore');
		expect(gitignore?.content).toContain('.gkm/');
	});
});

describe('generateDockerFiles', () => {
	it('should generate docker-compose.yml', () => {
		const files = generateDockerFiles(baseOptions, minimalTemplate);
		expect(files).toHaveLength(1);
		expect(files[0].path).toBe('docker-compose.yml');
	});

	it('should include postgres with dynamic port when database is enabled', () => {
		const files = generateDockerFiles(baseOptions, minimalTemplate);
		expect(files[0].content).toContain('postgres');
		expect(files[0].content).toContain("'${POSTGRES_HOST_PORT:-5432}:5432'");
	});

	it('should include redis with dynamic port', () => {
		const files = generateDockerFiles(baseOptions, minimalTemplate);
		expect(files[0].content).toContain('redis');
		expect(files[0].content).toContain("'${REDIS_HOST_PORT:-6379}:6379'");
	});

	it('should include serverless-redis-http with dynamic port for serverless template', () => {
		const options = { ...baseOptions, template: 'serverless' as const };
		const files = generateDockerFiles(options, serverlessTemplate);
		expect(files[0].content).toContain('hiett/serverless-redis-http');
		expect(files[0].content).toContain("'${SRH_HOST_PORT:-8079}:80'");
	});

	it('should include rabbitmq with dynamic ports for worker template', () => {
		const options = { ...baseOptions, template: 'worker' as const };
		const files = generateDockerFiles(options, workerTemplate);
		expect(files[0].content).toContain('rabbitmq');
		expect(files[0].content).toContain("'${RABBITMQ_HOST_PORT:-5672}:5672'");
		expect(files[0].content).toContain(
			"'${RABBITMQ_MGMT_HOST_PORT:-15672}:15672'",
		);
	});

	it('should include mailpit with dynamic ports when mail is enabled', () => {
		const options = {
			...baseOptions,
			services: { ...baseOptions.services, mail: true },
		};
		const files = generateDockerFiles(options, minimalTemplate);
		expect(files[0].content).toContain('mailpit');
		expect(files[0].content).toContain("'${SMTP_PORT:-1025}:1025'");
		expect(files[0].content).toContain("'${MAILPIT_PORT:-8025}:8025'");
		expect(files[0].content).toContain('MP_SMTP_AUTH:');
	});

	it('should include minio with dynamic ports when storage is enabled', () => {
		const options = {
			...baseOptions,
			services: { ...baseOptions.services, storage: true },
		};
		const files = generateDockerFiles(options, minimalTemplate);
		expect(files[0].content).toContain('minio');
		// pgsty's build, and pinned: MinIO's own images left Docker Hub and
		// then Quay went behind a login, and each time a scaffolded project
		// could not start.
		expect(files[0].content).toContain(
			'pgsty/minio:RELEASE.2026-08-04T00-00-00Z',
		);
		expect(files[0].content).toContain("'${MINIO_API_HOST_PORT:-9000}:9000'");
		expect(files[0].content).toContain(
			"'${MINIO_CONSOLE_HOST_PORT:-9001}:9001'",
		);
		expect(files[0].content).toContain('MINIO_ROOT_USER:');
		expect(files[0].content).toContain('MINIO_ROOT_PASSWORD:');
		expect(files[0].content).toContain('minio_data:');
	});

	it('should include all services when all are enabled', () => {
		const options = {
			...baseOptions,
			services: { db: true, cache: true, mail: true, storage: true },
		};
		const files = generateDockerFiles(options, minimalTemplate);
		expect(files[0].content).toContain('postgres');
		expect(files[0].content).toContain('redis');
		expect(files[0].content).toContain('mailpit');
		expect(files[0].content).toContain('minio');
	});

	it('should not include disabled services', () => {
		const options = {
			...baseOptions,
			database: false,
			services: { db: false, cache: false, mail: false, storage: false },
		};
		const files = generateDockerFiles(options, minimalTemplate);
		expect(files[0].content).not.toContain('postgres');
		expect(files[0].content).toContain('redis'); // redis is always included
		expect(files[0].content).not.toContain('mailpit');
		expect(files[0].content).not.toContain('minio');
	});

	it('should include the AWS emulator when events is sns', () => {
		const options = {
			...baseOptions,
			services: {
				db: true,
				cache: true,
				mail: false,
				storage: false,
				events: 'sns' as const,
			},
		};
		const files = generateDockerFiles(options, minimalTemplate);
		const compose = files[0].content;
		expect(compose).toContain('localstack');
		expect(compose).toContain('floci/floci');
		// No SERVICES list: the emulator enables everything, so there is nothing
		// to keep in step with what the app actually publishes to.
		expect(compose).not.toContain('SERVICES:');
		expect(compose).toContain('LOCALSTACK_PORT');
	});

	it('should include rabbitmq when events is rabbitmq', () => {
		const options = {
			...baseOptions,
			services: {
				db: true,
				cache: true,
				mail: false,
				storage: false,
				events: 'rabbitmq' as const,
			},
		};
		const files = generateDockerFiles(options, minimalTemplate);
		const compose = files[0].content;
		expect(compose).toContain('rabbitmq');
		expect(compose).toContain('RABBITMQ_HOST_PORT');
	});

	it('should not add extra container for pgboss events', () => {
		const options = {
			...baseOptions,
			services: {
				db: true,
				cache: true,
				mail: false,
				storage: false,
				events: 'pgboss' as const,
			},
		};
		const files = generateDockerFiles(options, minimalTemplate);
		const compose = files[0].content;
		expect(compose).not.toContain('localstack');
		// pgboss reuses postgres, no separate container
	});

	it('should generate idempotent postgres init script with pgboss', () => {
		const options = {
			...baseOptions,
			template: 'fullstack' as const,
			monorepo: true,
			apiPath: 'apps/api',
			services: {
				db: true,
				cache: true,
				mail: false,
				storage: false,
				events: 'pgboss' as const,
			},
		};
		const dbApps = [
			{ name: 'api', password: 'api-pass' },
			{ name: 'auth', password: 'auth-pass' },
		];
		const files = generateDockerFiles(options, apiTemplate, dbApps);
		const initScript = files.find((f) => f.path === 'docker/postgres/init.sh');
		expect(initScript).toBeDefined();
		expect(initScript!.content).toContain('IF NOT EXISTS');
		expect(initScript!.content).toContain('pgboss');
		expect(initScript!.content).toContain('PGBOSS_DB_PASSWORD');
		expect(initScript!.content).toContain('CREATE SCHEMA IF NOT EXISTS pgboss');

		// Docker env should include pgboss password
		const envFile = files.find((f) => f.path === 'docker/.env');
		expect(envFile).toBeDefined();
		expect(envFile!.content).toContain('PGBOSS_DB_PASSWORD');
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
		expect(pkgJson).toBeDefined();
		const pkg = JSON.parse(pkgJson!.content);
		expect(pkg.scripts.dev).toBe('turbo dev');
		expect(pkg.scripts.build).toBe('turbo build');
		expect(pkg.scripts.lint).toBe('biome lint .');
	});
});

describe('generateTanStackWebFiles', () => {
	const fullstackOptions: TemplateOptions = {
		...baseOptions,
		template: 'fullstack',
		monorepo: true,
		apiPath: 'apps/api',
		frontendFramework: 'tanstack-start',
	};

	it('returns empty array for non-fullstack template', () => {
		expect(generateTanStackWebFiles(baseOptions)).toHaveLength(0);
	});

	it('generates the expected file paths', () => {
		const files = generateTanStackWebFiles(fullstackOptions);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('apps/web/package.json');
		expect(paths).toContain('apps/web/vite.config.ts');
		expect(paths).toContain('apps/web/src/router.tsx');
		expect(paths).toContain('apps/web/src/routes/__root.tsx');
		expect(paths).toContain('apps/web/src/routes/index.tsx');
		expect(paths).toContain('apps/web/src/config/client.ts');
	});

	it('uses VITE_ prefix in client config, not NEXT_PUBLIC_', () => {
		const files = generateTanStackWebFiles(fullstackOptions);
		const clientConfig = files.find(
			(f) => f.path === 'apps/web/src/config/client.ts',
		);
		expect(clientConfig).toBeDefined();
		expect(clientConfig!.content).toContain('VITE_API_URL');
		expect(clientConfig!.content).toContain('VITE_AUTH_URL');
		expect(clientConfig!.content).not.toContain('NEXT_PUBLIC_');
	});

	it('declares tanstack and vite as dependencies', () => {
		const files = generateTanStackWebFiles(fullstackOptions);
		const pkg = JSON.parse(
			files.find((f) => f.path === 'apps/web/package.json')!.content,
		);
		expect(pkg.dependencies['@tanstack/react-start']).toBeDefined();
		expect(pkg.dependencies['@tanstack/react-router']).toBeDefined();
		expect(pkg.devDependencies.vite).toBeDefined();
		expect(pkg.dependencies.next).toBeUndefined();
	});
});

describe('generateExpoAppFiles', () => {
	const fullstackOptions: TemplateOptions = {
		...baseOptions,
		template: 'fullstack',
		monorepo: true,
		apiPath: 'apps/api',
		frontendFramework: 'expo',
	};

	it('returns empty array for non-fullstack template', () => {
		expect(generateExpoAppFiles(baseOptions)).toHaveLength(0);
	});

	it('generates the expected Expo file paths', () => {
		const files = generateExpoAppFiles(fullstackOptions);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('apps/app/package.json');
		expect(paths).toContain('apps/app/app.config.ts');
		expect(paths).toContain('apps/app/eas.json');
		expect(paths).toContain('apps/app/babel.config.js');
		expect(paths).toContain('apps/app/metro.config.js');
		expect(paths).toContain('apps/app/app/_layout.tsx');
		expect(paths).toContain('apps/app/app/index.tsx');
		expect(paths).toContain('apps/app/app/login.tsx');
		expect(paths).toContain('apps/app/lib/auth-client.ts');
	});

	it('uses EXPO_PUBLIC_ prefix in config.ts', () => {
		const files = generateExpoAppFiles(fullstackOptions);
		const configTs = files.find((f) => f.path === 'apps/app/config.ts');
		expect(configTs).toBeDefined();
		expect(configTs!.content).toContain('EXPO_PUBLIC_API_URL');
		expect(configTs!.content).toContain('EXPO_PUBLIC_AUTH_URL');
		expect(configTs!.content).not.toContain('VITE_');
		expect(configTs!.content).not.toContain('NEXT_PUBLIC_');
	});

	it('seeds eas.json with EXPO_PUBLIC_ env vars per profile', () => {
		const files = generateExpoAppFiles(fullstackOptions);
		const eas = JSON.parse(
			files.find((f) => f.path === 'apps/app/eas.json')!.content,
		);
		expect(eas.build.dev.env.EXPO_PUBLIC_API_URL).toBeDefined();
		expect(eas.build.dev.env.EXPO_PUBLIC_AUTH_URL).toBeDefined();
	});

	it('declares expo + better-auth/expo as dependencies', () => {
		const files = generateExpoAppFiles(fullstackOptions);
		const pkg = JSON.parse(
			files.find((f) => f.path === 'apps/app/package.json')!.content,
		);
		expect(pkg.dependencies.expo).toBeDefined();
		expect(pkg.dependencies['@better-auth/expo']).toBeDefined();
		expect(pkg.dependencies['expo-router']).toBeDefined();
		expect(pkg.dependencies.next).toBeUndefined();
	});
});

describe('generateRootConstructs - the apps, as constructs', () => {
	const fullstackBase: TemplateOptions = {
		...baseOptions,
		template: 'fullstack',
		monorepo: true,
		apiPath: 'apps/api',
	};

	const at = (files: GeneratedFile[], path: string) =>
		files.find((f) => f.path === path);

	it('declares the site with the id that gives it its path', () => {
		const files = generateRootConstructs({
			...fullstackBase,
			frontendFramework: 'nextjs',
		});
		const site = at(files, 'constructs/site.ts');

		// No `path: 'apps/web'` — `Web` already says that.
		expect(site!.content).toContain(
			"new StaticSite('Web', { variant: 'next' })",
		);
		expect(site!.content).not.toContain('path:');
	});

	it('carries the framework as the site variant', () => {
		const files = generateRootConstructs({
			...fullstackBase,
			frontendFramework: 'tanstack-start',
		});

		expect(at(files, 'constructs/site.ts')!.content).toContain(
			"variant: 'tanstack'",
		);
	});

	it('declares no site for a mobile app, which no static site serves', () => {
		const files = generateRootConstructs({
			...fullstackBase,
			frontendFramework: 'expo',
		});

		expect(at(files, 'constructs/site.ts')).toBeUndefined();
	});

	it('gives the auth server a construct and no hand-written entry', () => {
		const files = generateRootConstructs(fullstackBase);
		const auth = at(files, 'constructs/auth.ts');

		expect(auth!.content).toContain("new BetterAuth('Auth'");
		expect(auth!.content).toContain("basePath: '/api/auth'");
		// Its schema in the declared Postgres, not a second database.
		expect(auth!.content).toContain('authDb');
	});

	it('wires the edges the deploy order and the CORS origins come from', () => {
		const files = generateRootConstructs(fullstackBase);

		expect(at(files, 'constructs/api.ts')!.content).toContain('.auth(auth)');
		expect(at(files, 'constructs/site.ts')!.content).toContain(
			'.dependsOn([api, auth])',
		);
	});

	it('declares nothing for a single-app project, which has no root', () => {
		expect(
			generateRootConstructs({ ...fullstackBase, monorepo: false }),
		).toEqual([]);
	});
});

describe('generateWorkspaceConfig, through generateMonorepoFiles', () => {
	const fullstackBase: TemplateOptions = {
		...baseOptions,
		template: 'fullstack',
		monorepo: true,
		apiPath: 'apps/api',
	};

	const config = (options: Partial<TemplateOptions> = {}) =>
		generateMonorepoFiles(
			{ ...fullstackBase, ...options } as TemplateOptions,
			minimalTemplate,
		).find((f) => f.path === 'gkm.config.ts')!.content;

	it('names no apps — they are the constructs that said they have a process', () => {
		const cfg = config();

		expect(cfg).toContain("constructs: './constructs/**/*.ts'");
		expect(cfg).not.toContain('apps: {');
		expect(cfg).not.toContain('envParser:');
		expect(cfg).not.toContain('logger:');
	});

	it('names no services — every one of them is derived or defaulted', () => {
		const cfg = config({
			services: { db: true, cache: true, mail: true, storage: true },
		});

		expect(cfg).not.toContain('services:');
	});

	it('names no deploy target — that is picked at deploy time', () => {
		expect(config({ deployTarget: 'dokploy' })).not.toContain('deploy:');
	});

	it('names no shared block, which nothing reads', () => {
		expect(config()).not.toContain('shared:');
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
		expect(paths).toContain('packages/models/src/common.ts');
		expect(paths).toContain('packages/models/src/user.ts');
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
		expect(pkgJson).toBeDefined();
		const pkg = JSON.parse(pkgJson!.content);
		expect(pkg.name).toBe('@test-project/models');
	});

	it('should have empty dependencies (zod is at root level)', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateModelsPackage(options);
		const pkgJson = files.find(
			(f) => f.path === 'packages/models/package.json',
		);
		expect(pkgJson).toBeDefined();
		const pkg = JSON.parse(pkgJson!.content);
		// zod is now at root level in monorepo, not in models package
		expect(pkg.dependencies).toEqual({});
	});

	it('should include example schemas', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateModelsPackage(options);
		const userTs = files.find((f) => f.path === 'packages/models/src/user.ts');
		const commonTs = files.find(
			(f) => f.path === 'packages/models/src/common.ts',
		);
		expect(userTs?.content).toContain('UserSchema');
		expect(userTs?.content).toContain('UserResponseSchema');
		expect(userTs?.content).toContain("import { z } from 'zod'");
		expect(commonTs?.content).toContain('PaginationSchema');
		expect(commonTs?.content).toContain('IdSchema');
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
		expect(tsConfig).toBeDefined();
		const config = JSON.parse(tsConfig!.content);
		expect(config.extends).toBe('../../tsconfig.json');
	});
});

describe('generateUiPackageFiles', () => {
	const fullstackOptions: TemplateOptions = {
		...baseOptions,
		template: 'fullstack',
		monorepo: true,
		apiPath: 'apps/api',
	};

	it('should return empty array for non-monorepo', () => {
		const files = generateUiPackageFiles(baseOptions);
		expect(files).toHaveLength(0);
	});

	it('should return empty array for non-fullstack template', () => {
		const options: TemplateOptions = {
			...baseOptions,
			template: 'minimal',
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateUiPackageFiles(options);
		expect(files).toHaveLength(0);
	});

	it('should generate UI package files for fullstack template', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('packages/ui/package.json');
		expect(paths).toContain('packages/ui/tsconfig.json');
		expect(paths).toContain('packages/ui/components.json');
		expect(paths).toContain('packages/ui/.storybook/main.ts');
		expect(paths).toContain('packages/ui/.storybook/preview.ts');
		expect(paths).toContain('packages/ui/src/styles/globals.css');
		expect(paths).toContain('packages/ui/src/lib/utils.ts');
		expect(paths).toContain('packages/ui/src/index.ts');
	});

	it('should use correct package name', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const pkgJson = files.find((f) => f.path === 'packages/ui/package.json');
		expect(pkgJson).toBeDefined();
		const pkg = JSON.parse(pkgJson!.content);
		expect(pkg.name).toBe('@test-project/ui');
	});

	it('should have typescript source exports (not dist)', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const pkgJson = files.find((f) => f.path === 'packages/ui/package.json');
		expect(pkgJson).toBeDefined();
		const pkg = JSON.parse(pkgJson!.content);
		expect(pkg.exports['.']).toBe('./src/index.ts');
		expect(pkg.exports['./components']).toBe('./src/components/index.ts');
		expect(pkg.exports['./lib/utils']).toBe('./src/lib/utils.ts');
		expect(pkg.exports['./styles']).toBe('./src/styles/globals.css');
	});

	it('should not have build script (private packages are not built)', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const pkgJson = files.find((f) => f.path === 'packages/ui/package.json');
		expect(pkgJson).toBeDefined();
		const pkg = JSON.parse(pkgJson!.content);
		expect(pkg.scripts.build).toBeUndefined();
		expect(pkg.scripts.storybook).toBeDefined();
		expect(pkg.scripts['build:storybook']).toBeDefined();
	});

	it('should include Radix UI dependencies', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const pkgJson = files.find((f) => f.path === 'packages/ui/package.json');
		expect(pkgJson).toBeDefined();
		const pkg = JSON.parse(pkgJson!.content);
		expect(pkg.dependencies['@radix-ui/react-slot']).toBeDefined();
		expect(pkg.dependencies['@radix-ui/react-dialog']).toBeDefined();
		expect(pkg.dependencies['@radix-ui/react-label']).toBeDefined();
		expect(pkg.dependencies['@radix-ui/react-separator']).toBeDefined();
		expect(pkg.dependencies['@radix-ui/react-tabs']).toBeDefined();
		expect(pkg.dependencies['@radix-ui/react-tooltip']).toBeDefined();
	});

	it('should include Storybook dependencies', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const pkgJson = files.find((f) => f.path === 'packages/ui/package.json');
		expect(pkgJson).toBeDefined();
		const pkg = JSON.parse(pkgJson!.content);
		expect(pkg.devDependencies['@storybook/react']).toBeDefined();
		expect(pkg.devDependencies['@storybook/react-vite']).toBeDefined();
		expect(pkg.devDependencies['@storybook/addon-essentials']).toBeDefined();
		expect(pkg.devDependencies.storybook).toBeDefined();
	});

	it('should include Tailwind CSS dependencies', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const pkgJson = files.find((f) => f.path === 'packages/ui/package.json');
		expect(pkgJson).toBeDefined();
		const pkg = JSON.parse(pkgJson!.content);
		expect(pkg.devDependencies.tailwindcss).toBeDefined();
		expect(pkg.devDependencies['@tailwindcss/vite']).toBeDefined();
		expect(pkg.peerDependencies.tailwindcss).toBeDefined();
	});

	it('should extend root tsconfig with noEmit', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const tsConfig = files.find((f) => f.path === 'packages/ui/tsconfig.json');
		expect(tsConfig).toBeDefined();
		const config = JSON.parse(tsConfig!.content);
		expect(config.extends).toBe('../../tsconfig.json');
		expect(config.compilerOptions.noEmit).toBe(true);
		expect(config.compilerOptions.jsx).toBe('react-jsx');
	});

	it('should not include tsdown.config.ts', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const paths = files.map((f) => f.path);
		expect(paths).not.toContain('packages/ui/tsdown.config.ts');
	});

	it('should generate all component files in folder structure', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const paths = files.map((f) => f.path);

		// Button
		expect(paths).toContain('packages/ui/src/components/ui/button/index.tsx');
		expect(paths).toContain(
			'packages/ui/src/components/ui/button/button.stories.tsx',
		);

		// Input
		expect(paths).toContain('packages/ui/src/components/ui/input/index.tsx');
		expect(paths).toContain(
			'packages/ui/src/components/ui/input/input.stories.tsx',
		);

		// Card
		expect(paths).toContain('packages/ui/src/components/ui/card/index.tsx');
		expect(paths).toContain(
			'packages/ui/src/components/ui/card/card.stories.tsx',
		);

		// Label
		expect(paths).toContain('packages/ui/src/components/ui/label/index.tsx');
		expect(paths).toContain(
			'packages/ui/src/components/ui/label/label.stories.tsx',
		);

		// Badge
		expect(paths).toContain('packages/ui/src/components/ui/badge/index.tsx');
		expect(paths).toContain(
			'packages/ui/src/components/ui/badge/badge.stories.tsx',
		);

		// Separator
		expect(paths).toContain(
			'packages/ui/src/components/ui/separator/index.tsx',
		);
		expect(paths).toContain(
			'packages/ui/src/components/ui/separator/separator.stories.tsx',
		);

		// Tabs
		expect(paths).toContain('packages/ui/src/components/ui/tabs/index.tsx');
		expect(paths).toContain(
			'packages/ui/src/components/ui/tabs/tabs.stories.tsx',
		);

		// Tooltip
		expect(paths).toContain('packages/ui/src/components/ui/tooltip/index.tsx');
		expect(paths).toContain(
			'packages/ui/src/components/ui/tooltip/tooltip.stories.tsx',
		);

		// Dialog
		expect(paths).toContain('packages/ui/src/components/ui/dialog/index.tsx');
		expect(paths).toContain(
			'packages/ui/src/components/ui/dialog/dialog.stories.tsx',
		);
	});

	it('should export all components from index', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const indexFile = files.find(
			(f) => f.path === 'packages/ui/src/components/ui/index.ts',
		);
		expect(indexFile).toBeDefined();
		expect(indexFile!.content).toContain("from './button.tsx'");
		expect(indexFile!.content).toContain("from './input.tsx'");
		expect(indexFile!.content).toContain("from './card.tsx'");
		expect(indexFile!.content).toContain("from './label.tsx'");
		expect(indexFile!.content).toContain("from './badge.tsx'");
		expect(indexFile!.content).toContain("from './separator.tsx'");
		expect(indexFile!.content).toContain("from './tabs.tsx'");
		expect(indexFile!.content).toContain("from './tooltip.tsx'");
		expect(indexFile!.content).toContain("from './dialog.tsx'");
	});

	it('should include cn utility function', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const utilsFile = files.find(
			(f) => f.path === 'packages/ui/src/lib/utils.ts',
		);
		expect(utilsFile).toBeDefined();
		expect(utilsFile!.content).toContain('export function cn');
		expect(utilsFile!.content).toContain('clsx');
		expect(utilsFile!.content).toContain('twMerge');
	});

	it('should include Tailwind v4 CSS with theme variables', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const globalsCss = files.find(
			(f) => f.path === 'packages/ui/src/styles/globals.css',
		);
		expect(globalsCss).toBeDefined();
		expect(globalsCss!.content).toContain('@import "tailwindcss"');
		expect(globalsCss!.content).toContain('@theme');
		expect(globalsCss!.content).toContain('--color-background');
		expect(globalsCss!.content).toContain('--color-primary');
		expect(globalsCss!.content).toContain('.dark');
	});

	it('should configure Storybook with Tailwind v4 plugin', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const storybookMain = files.find(
			(f) => f.path === 'packages/ui/.storybook/main.ts',
		);
		expect(storybookMain).toBeDefined();
		expect(storybookMain!.content).toContain('@storybook/react-vite');
		expect(storybookMain!.content).toContain('@tailwindcss/vite');
		expect(storybookMain!.content).toContain('viteFinal');
	});

	it('should import globals.css in Storybook preview', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const storybookPreview = files.find(
			(f) => f.path === 'packages/ui/.storybook/preview.ts',
		);
		expect(storybookPreview).toBeDefined();
		expect(storybookPreview!.content).toContain(
			"import '../src/styles/globals.css'",
		);
	});

	it('should include shadcn components.json config', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const componentsJson = files.find(
			(f) => f.path === 'packages/ui/components.json',
		);
		expect(componentsJson).toBeDefined();
		const config = JSON.parse(componentsJson!.content);
		expect(config.$schema).toContain('ui.shadcn.com');
		expect(config.style).toBe('new-york');
		expect(config.tailwind.cssVariables).toBe(true);
		expect(config.aliases.components).toBe('~/components');
		expect(config.aliases.utils).toBe('~/lib/utils');
	});

	it('should use ~/* path alias in components', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const buttonFile = files.find(
			(f) => f.path === 'packages/ui/src/components/ui/button/index.tsx',
		);
		expect(buttonFile).toBeDefined();
		expect(buttonFile!.content).toContain("from '~/lib/utils'");
	});

	it('should configure ~/* path in tsconfig', () => {
		const files = generateUiPackageFiles(fullstackOptions);
		const tsConfig = files.find((f) => f.path === 'packages/ui/tsconfig.json');
		expect(tsConfig).toBeDefined();
		const config = JSON.parse(tsConfig!.content);
		expect(config.compilerOptions.paths['~/*']).toEqual(['./src/*']);
	});
});

describe('generateTestFiles', () => {
	it('should return empty array when database is disabled', () => {
		const options = { ...baseOptions, database: false };
		const files = generateTestFiles(options, minimalTemplate);
		expect(files).toHaveLength(0);
	});

	it('should generate all test infrastructure files when database is enabled', () => {
		const files = generateTestFiles(baseOptions, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('test/config.ts');
		expect(paths).toContain('test/globalSetup.ts');
		expect(paths).toContain('test/factory/index.ts');
		expect(paths).toContain('test/factory/users.ts');
		expect(paths).toContain('test/example.spec.ts');
	});

	it('should use wrapVitestKyselyTransaction in config', () => {
		const files = generateTestFiles(baseOptions, minimalTemplate);
		const configFile = files.find((f) => f.path === 'test/config.ts');
		expect(configFile).toBeDefined();
		expect(configFile!.content).toContain('wrapVitestKyselyTransaction');
		expect(configFile!.content).toContain('@geekmidas/testkit/kysely');
		// The declared database's schema type, and the key it publishes.
		expect(configFile!.content).toContain('../src/constructs/database.ts');
		expect(configFile!.content).toContain('process.env.TEST_PROJECT_URL');
	});

	it('should migrate as the owner role in globalSetup', () => {
		const files = generateTestFiles(baseOptions, minimalTemplate);
		const setupFile = files.find((f) => f.path === 'test/globalSetup.ts');
		expect(setupFile).toBeDefined();
		expect(setupFile!.content).toContain('PostgresKyselyMigrator');
		expect(setupFile!.content).toContain('Credentials');

		// Migrations connect as the DDL role the database construct declares.
		expect(setupFile!.content).toContain('TEST_PROJECT_OWNER_URL');

		// Reconcile creates the roles before the suite runs, so there is no init
		// script left to run and no per-app password to thread through it.
		expect(setupFile!.content).not.toContain('runInitScript');
		expect(setupFile!.content).not.toContain('PGBOSS_DB_PASSWORD');
	});

	it('should use KyselyFactory in factory files', () => {
		const files = generateTestFiles(baseOptions, minimalTemplate);
		const factoryIndex = files.find((f) => f.path === 'test/factory/index.ts');
		expect(factoryIndex).toBeDefined();
		expect(factoryIndex!.content).toContain('KyselyFactory');
		expect(factoryIndex!.content).toContain('createFactory');

		const usersBuilder = files.find((f) => f.path === 'test/factory/users.ts');
		expect(usersBuilder).toBeDefined();
		expect(usersBuilder!.content).toContain('KyselyFactory.createBuilder');
		expect(usersBuilder!.content).toContain("'users'");
	});

	it('should generate example spec with transaction-wrapped it', () => {
		const files = generateTestFiles(baseOptions, minimalTemplate);
		const exampleSpec = files.find((f) => f.path === 'test/example.spec.ts');
		expect(exampleSpec).toBeDefined();
		expect(exampleSpec!.content).toContain("from './config.ts'");
		expect(exampleSpec!.content).toContain('{ db }');
	});

	it('should work with fullstack template options', () => {
		const options: TemplateOptions = {
			...baseOptions,
			template: 'fullstack',
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateTestFiles(options, apiTemplate);
		expect(files.length).toBeGreaterThan(0);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('test/config.ts');
		expect(paths).toContain('test/globalSetup.ts');
	});
});

describe('generateConfigFiles - vitest.config.ts', () => {
	it('should generate vitest.config.ts when database is enabled (standalone)', () => {
		const files = generateConfigFiles(baseOptions, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('vitest.config.ts');

		const vitestConfig = files.find((f) => f.path === 'vitest.config.ts');
		expect(vitestConfig!.content).toContain('globalSetup');
		expect(vitestConfig!.content).toContain('./test/globalSetup.ts');
		expect(vitestConfig!.content).toContain('vite-tsconfig-paths');
		expect(vitestConfig!.content).not.toContain('globals: true');
	});

	it('should not generate vitest.config.ts when database is disabled', () => {
		const options = { ...baseOptions, database: false };
		const files = generateConfigFiles(options, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).not.toContain('vitest.config.ts');
	});

	it('should generate vitest.config.ts for monorepo app with database', () => {
		const options: TemplateOptions = {
			...baseOptions,
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateConfigFiles(options, minimalTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('vitest.config.ts');
	});

	it('should generate vitest.config.ts for fullstack template with database', () => {
		const options: TemplateOptions = {
			...baseOptions,
			template: 'fullstack',
			monorepo: true,
			apiPath: 'apps/api',
		};
		const files = generateConfigFiles(options, apiTemplate);
		const paths = files.map((f) => f.path);
		expect(paths).toContain('vitest.config.ts');
	});
});

describe('generatePackageJson - testkit dependencies', () => {
	it('should include testkit and faker when database is enabled', () => {
		const files = generatePackageJson(baseOptions, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.devDependencies['@geekmidas/testkit']).toMatch(/^~/);
		expect(pkg.devDependencies['@faker-js/faker']).toMatch(/^~/);
	});

	it('should not include testkit when database is disabled', () => {
		const options = { ...baseOptions, database: false };
		const files = generatePackageJson(options, minimalTemplate);
		const pkg = JSON.parse(files[0].content);
		expect(pkg.devDependencies['@geekmidas/testkit']).toBeUndefined();
		expect(pkg.devDependencies['@faker-js/faker']).toBeUndefined();
	});
});

describe('generateAgentFiles', () => {
	it('writes AGENTS.md and a CLAUDE.md that points at it', () => {
		const files = generateAgentFiles(baseOptions, minimalTemplate);

		expect(files.map((f) => f.path)).toEqual(['AGENTS.md', 'CLAUDE.md']);

		// The instructions live in one file. `CLAUDE.md` refers to it rather than
		// repeating it, because the copy that drifts is the one nobody opened.
		const claude = files.find((f) => f.path === 'CLAUDE.md')!.content;
		expect(claude).toContain('[AGENTS.md](./AGENTS.md)');
		expect(claude).not.toContain('## Commands');
	});

	it('names the glob the workspace actually uses', () => {
		// A monorepo keeps constructs at its root; a single app keeps them under
		// `src/`. The guide quotes the config, so quoting the wrong one is the
		// first thing a reader would check and the first reason to distrust it.
		const single = generateAgentFiles(baseOptions, minimalTemplate)[0].content;
		expect(single).toContain("constructs: './src/constructs/**/*.ts'");

		const workspace = generateAgentFiles(
			{ ...baseOptions, monorepo: true, apiPath: 'apps/api' },
			minimalTemplate,
		)[0].content;
		expect(workspace).toContain("constructs: './constructs/**/*.ts'");
		expect(workspace).not.toContain('./src/constructs/**/*.ts');
	});

	it('documents only what was generated', () => {
		// A worker has no HTTP surface, so an endpoint guide beside it would be
		// teaching an API this project does not have.
		const worker = generateAgentFiles(
			{ ...baseOptions, template: 'worker' },
			workerTemplate,
		)[0].content;
		expect(worker).not.toContain('## Adding an endpoint');

		const api = generateAgentFiles(baseOptions, apiTemplate)[0].content;
		expect(api).toContain('## Adding an endpoint');
	});

	it('omits the database section when there is no database', () => {
		const without = generateAgentFiles(
			{
				...baseOptions,
				database: false,
				services: { ...baseOptions.services, db: false },
			},
			minimalTemplate,
		)[0].content;
		expect(without).not.toContain('## Database');

		expect(
			generateAgentFiles(baseOptions, minimalTemplate)[0].content,
		).toContain('## Database');
	});

	it('states the Zod convention, which is the easiest thing here to get wrong', () => {
		const agents = generateAgentFiles(baseOptions, minimalTemplate)[0].content;
		expect(agents).toContain('z.email()');
		expect(agents).toContain('z.string().email()');
	});

	it('uses the package manager the project was scaffolded with', () => {
		const npm = generateAgentFiles(
			{ ...baseOptions, packageManager: 'npm' },
			minimalTemplate,
		)[0].content;
		expect(npm).toContain('npx gkm dev');

		const pnpm = generateAgentFiles(baseOptions, minimalTemplate)[0].content;
		expect(pnpm).toContain('pnpm exec gkm dev');
	});
});
