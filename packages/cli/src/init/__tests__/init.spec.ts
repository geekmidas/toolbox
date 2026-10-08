import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../index.js';

describe('initCommand', () => {
	let tempDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `cli-init-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
		originalCwd = process.cwd();
		process.chdir(tempDir);
		// Stage keys land in the CLI's home; never the real one.
		vi.stubEnv('GKM_HOME', join(tempDir, '.gkm-home'));
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		vi.unstubAllEnvs();
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
			// No hand-written compose: the containers are derived from the
			// declared constructs, into a file gkm writes and git ignores.
			expect(existsSync(join(projectDir, 'docker-compose.yml'))).toBe(false);
			// Secrets are now encrypted instead of .env files
			expect(existsSync(join(projectDir, '.gkm/secrets/local.json'))).toBe(
				true,
			);
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
			// The database is a construct, not a hand-written service.
			expect(existsSync(join(projectDir, 'src/constructs/database.ts'))).toBe(
				true,
			);
			expect(existsSync(join(projectDir, 'src/services/database.ts'))).toBe(
				false,
			);

			const database = await readFile(
				join(projectDir, 'src/constructs/database.ts'),
				'utf-8',
			);
			expect(database).toContain('KyselyDatabase');
			// A plain id: the project name already scopes every physical name,
			// so `MyApi` here would deploy as `production-my-api-my-api`.
			expect(database).toContain(
				"new KyselyDatabase<Database, 'Database'>('Database', {",
			);
			// The plugin is written out, where the project can see and change it,
			// and the schema is camelCase to match.
			expect(database).toContain('plugins: [new CamelCasePlugin()]');
			expect(database).toContain('createdAt: Generated<Date>');
			expect(database).not.toContain('MyApi');

			// And the config points reconcile at it.
			const config = await readFile(join(projectDir, 'gkm.config.ts'), 'utf-8');
			expect(config).toContain("constructs: './src/constructs/**/*.ts'");
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

		it('should build the worker template from a Worker, not an HTTP surface', async () => {
			await initCommand('my-api', {
				template: 'worker',
				yes: true,
				skipInstall: true,
			});

			const projectDir = join(tempDir, 'my-api');

			const worker = await readFile(
				join(projectDir, 'src/constructs/worker.ts'),
				'utf-8',
			);
			expect(worker).toContain("new Worker('Jobs'");

			// A project whose premise is that nothing calls it over HTTP has no
			// business declaring an HTTP surface. It used to declare one with no
			// endpoints on it, because a surface was the only way to make an app
			// exist at all.
			expect(existsSync(join(projectDir, 'src/constructs/api.ts'))).toBe(false);

			expect(
				existsSync(join(projectDir, 'src/subscribers/user-events.ts')),
			).toBe(true);
			// Events are a declared topic, not a hand-rolled publisher service
			// reading a broker URL of its own.
			expect(existsSync(join(projectDir, 'src/events'))).toBe(false);
			const topics = await readFile(
				join(projectDir, 'src/constructs/topics.ts'),
				'utf8',
			);
			expect(topics).toContain("new Topic('users', {");
			const subscriber = await readFile(
				join(projectDir, 'src/subscribers/user-events.ts'),
				'utf8',
			);
			expect(subscriber).toContain('.topic(users)');
		});

		it('scaffolds a cron, and points it at where the schedule lives', async () => {
			await initCommand('my-api', {
				template: 'worker',
				yes: true,
				skipInstall: true,
			});

			const projectDir = join(tempDir, 'my-api');
			expect(existsSync(join(projectDir, 'src/crons/cleanup.ts'))).toBe(true);

			// A server fires its own crons, and the schedule is kept in Postgres so
			// that more than one replica still fires each job once. The worker names
			// which database that is; nothing here reads a connection string.
			const worker = await readFile(
				join(projectDir, 'src/constructs/worker.ts'),
				'utf-8',
			);
			expect(worker).toContain('.database(database)');

			const cron = await readFile(
				join(projectDir, 'src/crons/cleanup.ts'),
				'utf-8',
			);
			expect(cron).toContain("cron('rate(1 day)')");
		});

		it('gives a worker its subscriber from the worker itself', async () => {
			await initCommand('my-api', {
				template: 'worker',
				yes: true,
				skipInstall: true,
			});

			const subscriber = await readFile(
				join(tempDir, 'my-api', 'src/subscribers/user-events.ts'),
				'utf-8',
			);

			// Built from the worker, so it carries the worker's logger and says
			// which process runs it — and handed a batch, which is what both
			// transports deliver.
			expect(subscriber).toContain('worker\n  .topic(users)');
			expect(subscriber).toContain('async ({ events, logger })');
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
			expect(
				existsSync(join(projectDir, 'packages/models/src/common.ts')),
			).toBe(true);
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
			// zod is at root level in monorepo, not in models package
			expect(pkg.dependencies).toEqual({});

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
		it('holds no fixed login anywhere — the local ones are generated per machine', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});
			const projectDir = join(tempDir, 'my-fullstack');

			const files = (await readdir(projectDir, { recursive: true }))
				.map((file) => join(projectDir, file))
				.filter((path) => !/[\\/](node_modules|\.git)[\\/]/.test(path));
			const offending: string[] = [];
			for (const path of files) {
				if (!(await stat(path)).isFile()) continue;
				const text = (await readFile(path, 'utf-8'))
					// The packages it depends on, their docs, and the spell
					// checker's word for their scope are names, not logins.
					.replaceAll('@geekmidas', '')
					.replaceAll('geekmidas.github.io', '')
					.replaceAll('github.com/geekmidas/', '')
					.replace(/^\s*"geekmidas",?$/m, '');
				if (/geekmidas/i.test(text)) offending.push(path);
			}

			expect(offending).toEqual([]);
		});

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
			expect(content).toContain("'./constructs/**/*.ts',");
			expect(content).toContain("'./apps/*/src/endpoints/**/*.ts',");

			// The apps are the constructs that said they have a process, so none
			// of this is here to drift from them.
			expect(content).not.toContain('apps: {');
			expect(content).not.toContain("type: 'backend'");
			expect(content).not.toContain("framework: 'nextjs'");
			expect(content).not.toContain('envParser:');
			expect(content).not.toContain('logger:');
		});

		it('declares the three apps as constructs', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const dir = join(tempDir, 'my-fullstack', 'constructs');

			const api = await readFile(join(dir, 'api.ts'), 'utf-8');
			expect(api).toContain("new RestApi('Api'");
			expect(api).toContain('.auth(auth)');
			// Each says where its app lives; nothing infers it from the id.
			expect(api).toContain("path: 'apps/api'");

			const auth = await readFile(join(dir, 'auth.ts'), 'utf-8');
			expect(auth).toContain("new BetterAuth('Auth'");
			expect(auth).toContain("path: 'apps/auth'");

			const site = await readFile(join(dir, 'site.ts'), 'utf-8');
			expect(site).toContain("new StaticSite('Web'");
			expect(site).toContain("path: 'apps/web'");
			expect(site).toContain('.dependsOn([api, auth])');
		});

		it('leaves the auth app with no hand-written server', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			// The routes are a wildcard, so the build generates the entry from
			// the declaration. There is nothing here to keep in step with it.
			const dir = join(tempDir, 'my-fullstack', 'apps/auth');
			await expect(
				readFile(join(dir, 'src/index.ts'), 'utf-8'),
			).rejects.toThrow();
			await expect(
				readFile(join(dir, 'src/auth.ts'), 'utf-8'),
			).rejects.toThrow();
			await expect(
				readFile(join(dir, 'package.json'), 'utf-8'),
			).resolves.toContain('@my-fullstack/auth');
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

		it('configures no services — a declared construct is what brings each up', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const configPath = join(tempDir, 'my-fullstack', 'gkm.config.ts');
			const content = await readFile(configPath, 'utf-8');

			// Postgres because a database was declared, MinIO because a bucket
			// was — and which backend serves each follows the deploy target.
			expect(content).not.toContain('services:');

			const dir = join(tempDir, 'my-fullstack', 'constructs');
			await expect(
				readFile(join(dir, 'database.ts'), 'utf-8'),
			).resolves.toContain('KyselyDatabase');
			await expect(
				readFile(join(dir, 'storage.ts'), 'utf-8'),
			).resolves.toContain('ObjectStorage');
		});

		it('configures no deploy target — that is picked at deploy time', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const configPath = join(tempDir, 'my-fullstack', 'gkm.config.ts');
			const content = await readFile(configPath, 'utf-8');

			expect(content).not.toContain('deploy:');

			// And \`--yes\` picks no host: a default that wrote one provider's
			// deploy script would commit every unattended scaffold to it.
			const pkgPath = join(tempDir, 'my-fullstack', 'package.json');
			const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));

			expect(pkg.scripts.deploy).toBeUndefined();
			expect(existsSync(join(tempDir, 'my-fullstack', 'sst.config.ts'))).toBe(
				false,
			);
		});

		it('scaffolds a Dokploy deploy with --deploy dokploy', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
				deploy: 'dokploy',
			});

			const root = join(tempDir, 'my-fullstack');
			const pkg = JSON.parse(
				await readFile(join(root, 'package.json'), 'utf-8'),
			);

			expect(pkg.scripts['deploy:production']).toBe(
				'gkm deploy --stage production',
			);
			expect(existsSync(join(root, 'sst.config.ts'))).toBe(false);
			await expect(
				readFile(join(root, 'gkm.config.ts'), 'utf-8'),
			).resolves.not.toContain('deploy:');
			const tsconfig = JSON.parse(
				await readFile(join(root, 'tsconfig.json'), 'utf-8'),
			);
			expect(tsconfig.compilerOptions.paths['@my-fullstack/manifest']).toEqual([
				'./.gkm/manifest/server.ts',
			]);
		});

		it('scaffolds an SST deploy with --deploy sst', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
				deploy: 'sst',
				region: 'eu-west-1',
			});

			const root = join(tempDir, 'my-fullstack');
			const pkg = JSON.parse(
				await readFile(join(root, 'package.json'), 'utf-8'),
			);

			// gkm deploy builds the manifest SST reads, then runs sst deploy.
			expect(pkg.scripts['deploy:production']).toBe(
				'gkm deploy --stage production',
			);
			// What a bare `gkm build` builds for, and what backends resolve to.
			await expect(
				readFile(join(root, 'gkm.config.ts'), 'utf-8'),
			).resolves.toContain("deploy: { default: 'sst' },");
			// The api package exports nothing: its client is the application's,
			// generated at the root and reached through the tsconfig alias.
			const api = JSON.parse(
				await readFile(join(root, 'apps/api/package.json'), 'utf-8'),
			);
			expect(api.exports).toBeUndefined();
			// What the client imports is installed where the client is — the
			// root — and React with it, the one every frontend runs.
			expect(api.dependencies).not.toHaveProperty('@geekmidas/client');
			for (const dep of [
				'@geekmidas/client',
				'@tanstack/react-query',
				'react',
			]) {
				expect(pkg.dependencies[dep]).toBeDefined();
			}
			const rootTsconfig = JSON.parse(
				await readFile(join(root, 'tsconfig.json'), 'utf-8'),
			);
			expect(
				rootTsconfig.compilerOptions.paths['@my-fullstack/client/*'],
			).toEqual(['./.gkm/client/*']);
			const web = JSON.parse(
				await readFile(join(root, 'apps/web/tsconfig.json'), 'utf-8'),
			);
			expect(web.compilerOptions.paths['@my-fullstack/client/*']).toEqual([
				'../../.gkm/client/*',
			]);
			expect(pkg.devDependencies.sst).toMatch(/^~4\./);
			// What \`@geekmidas/cloud/sst\` imports: optional peers of the cloud
			// package, so the scaffold installs them itself.
			for (const dep of [
				'@geekmidas/cloud',
				'@geekmidas/db',
				'@geekmidas/envkit',
				'@geekmidas/events',
				'@geekmidas/manifest',
				'@geekmidas/storage',
				'pg',
			]) {
				expect(pkg.dependencies[dep]).toBeDefined();
			}

			const config = await readFile(join(root, 'sst.config.ts'), 'utf-8');
			expect(config).toContain("await import('@geekmidas/cloud/sst')");
			expect(config).toContain("await import('./.gkm/manifest/aws.js')");
			expect(config).toContain("name: 'my-fullstack'");
			// The region asked for, written down — never a fallback.
			expect(config).toContain("const region = 'eu-west-1';");
			expect(config).not.toContain('AWS_REGION');
			// The database needs a network, keyed by its plain id.
			expect(config).toContain('Database: { vpc }');

			await expect(
				readFile(join(root, '.gitignore'), 'utf-8'),
			).resolves.toContain('.sst/');
			const tsconfig = JSON.parse(
				await readFile(join(root, 'tsconfig.json'), 'utf-8'),
			);
			expect(tsconfig.exclude).toContain('sst.config.ts');
			// The manifest is the workspace's, at its root, by name.
			expect(tsconfig.compilerOptions.paths['@my-fullstack/manifest']).toEqual([
				'./.gkm/manifest/aws.ts',
			]);
		});

		it('takes eu-west-1 for an unattended SST deploy', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
				deploy: 'sst',
			});

			await expect(
				readFile(join(tempDir, 'my-fullstack', 'sst.config.ts'), 'utf-8'),
			).resolves.toContain("const region = 'eu-west-1';");
		});

		it('refuses a region that is not one', async () => {
			await expect(
				initCommand('my-fullstack', {
					template: 'fullstack',
					yes: true,
					skipInstall: true,
					deploy: 'sst',
					region: 'europe',
				}),
			).rejects.toThrow('"europe" is not an AWS region');
		});

		it('refuses a deploy target it does not know', async () => {
			await expect(
				initCommand('my-fullstack', {
					template: 'fullstack',
					yes: true,
					skipInstall: true,
					deploy: 'heroku' as never,
				}),
			).rejects.toThrow('Unknown deploy target "heroku"');
			expect(existsSync(join(tempDir, 'my-fullstack'))).toBe(false);
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

	describe('test infrastructure', () => {
		it('should generate test files for standalone app with database', async () => {
			await initCommand('my-api', {
				template: 'api',
				yes: true,
				skipInstall: true,
			});

			const projectDir = join(tempDir, 'my-api');
			expect(existsSync(join(projectDir, 'test/config.ts'))).toBe(true);
			expect(existsSync(join(projectDir, 'test/globalSetup.ts'))).toBe(false);
			expect(existsSync(join(projectDir, 'test/factories/database.ts'))).toBe(
				true,
			);
			expect(existsSync(join(projectDir, 'test/example.spec.ts'))).toBe(true);
			expect(existsSync(join(projectDir, 'vitest.config.ts'))).toBe(true);
		});

		it('should include testkit and faker in devDependencies', async () => {
			await initCommand('my-api', {
				template: 'api',
				yes: true,
				skipInstall: true,
			});

			const pkgPath = join(tempDir, 'my-api', 'package.json');
			const content = await readFile(pkgPath, 'utf-8');
			const pkg = JSON.parse(content);
			expect(pkg.devDependencies['@geekmidas/testkit']).toMatch(/^~/);
			expect(pkg.devDependencies['@faker-js/faker']).toMatch(/^~/);
		});

		it('should generate test files for fullstack api app', async () => {
			await initCommand('my-fullstack', {
				template: 'fullstack',
				yes: true,
				skipInstall: true,
			});

			const apiDir = join(tempDir, 'my-fullstack', 'apps/api');
			expect(existsSync(join(apiDir, 'test/config.ts'))).toBe(true);
			expect(existsSync(join(apiDir, 'test/globalSetup.ts'))).toBe(false);
			// The project's factory, at the root — every app's tests get it.
			expect(existsSync(join(apiDir, 'test/factories'))).toBe(false);
			expect(
				existsSync(join(tempDir, 'my-fullstack', 'test/factories/database.ts')),
			).toBe(true);
			expect(existsSync(join(apiDir, 'vitest.config.ts'))).toBe(true);
		});

		it('should include globalSetup and resolve tsconfig paths in vitest.config.ts', async () => {
			await initCommand('my-api', {
				template: 'api',
				yes: true,
				skipInstall: true,
			});

			const vitestConfigPath = join(tempDir, 'my-api', 'vitest.config.ts');
			const content = await readFile(vitestConfigPath, 'utf-8');
			expect(content).toContain("globalSetup: ['@geekmidas/cli/vitest']");
			// Vite resolves them itself; the plugin's tsconfck peers TS 5 only.
			expect(content).toContain('tsconfigPaths: true');
			expect(content).not.toContain('vite-tsconfig-paths');
			expect(content).not.toContain('globals: true');
		});
	});

	describe('docker-compose', () => {
		it.each([
			'minimal',
			'serverless',
			'worker',
		] as const)('writes no compose file for the %s template — the constructs are the list', async (template) => {
			await initCommand('my-api', { template, yes: true, skipInstall: true });

			expect(existsSync(join(tempDir, 'my-api', 'docker-compose.yml'))).toBe(
				false,
			);
		});

		it('ignores the compose file gkm writes, and not one the project owns', async () => {
			await initCommand('my-api', {
				template: 'minimal',
				yes: true,
				skipInstall: true,
			});

			const gitignore = await readFile(
				join(tempDir, 'my-api', '.gitignore'),
				'utf-8',
			);
			expect(gitignore).toMatch(/^docker-compose\.constructs\.yml$/m);
			expect(gitignore).not.toMatch(/^docker-compose\.yml$/m);
		});
	});
});
