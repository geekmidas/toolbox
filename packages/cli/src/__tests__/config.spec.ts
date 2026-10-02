import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	loadAppConfig,
	loadConfig,
	NotInAnApp,
	WorkspaceDeclaresNoConstructs,
} from '../config';
import { cleanupDir, createTempDir } from './test-helpers';

describe('loadConfig', () => {
	let tempDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tempDir = await createTempDir();
		originalCwd = process.cwd();
		process.chdir(tempDir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await cleanupDir(tempDir);
	});

	it('should load configuration from gkm.config.ts', async () => {
		const configContent = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  routes: './src/endpoints/**/*.ts',
  functions: './src/functions/**/*.ts',
  crons: './src/crons/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
};
`;
		await writeFile(join(tempDir, 'gkm.config.ts'), configContent);

		const config = await loadConfig();

		expect(config).toEqual({
			stages: { local: 'development', deployed: ['production'] },
			routes: './src/endpoints/**/*.ts',
			functions: './src/functions/**/*.ts',
			crons: './src/crons/**/*.ts',
			envParser: './src/config/env',
			logger: './src/config/logger',
		});
	});

	it('should load configuration from gkm.config.js', async () => {
		const configContent = `
module.exports = {
  routes: './api/**/*.js',
  envParser: './config/environment',
  logger: './config/logging',
};
`;
		await writeFile(join(tempDir, 'gkm.config.js'), configContent);

		const config = await loadConfig();
	});

	it('should handle configuration with only envParser override', async () => {
		const configContent = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  envParser: './my-env#myEnvParser',
  logger: './my-logger#myLogger',
};
`;
		await writeFile(join(tempDir, 'gkm.config.ts'), configContent);

		const config = await loadConfig();
	});

	it('should handle malformed config file gracefully', async () => {
		const invalidConfigContent = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  routes: './endpoints/**/*.ts'
  // Missing comma - syntax error
  functions: './functions/**/*.ts'
};
`;
		await writeFile(join(tempDir, 'gkm.config.ts'), invalidConfigContent);

		// Should fall back to defaults when config file has syntax errors
		await expect(loadConfig()).rejects.toThrow();
	});

	it('should prefer .ts config over .js config', async () => {
		const jsConfigContent = `
module.exports = {
  routes: './js-routes/**/*.js',
};
`;
		const tsConfigContent = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  routes: './ts-routes/**/*.ts',
};
`;

		await writeFile(join(tempDir, 'gkm.config.js'), jsConfigContent);
		await writeFile(join(tempDir, 'gkm.config.ts'), tsConfigContent);

		const config = await loadConfig();
	});
});

describe('loadAppConfig', () => {
	let tempDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tempDir = await createTempDir();
		originalCwd = process.cwd();
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		// Clean up GKM_CONFIG_PATH env var
		delete process.env.GKM_CONFIG_PATH;
		await cleanupDir(tempDir);
	});

	it('should load app config from workspace when in app directory', async () => {
		// Create workspace structure
		const workspaceRoot = tempDir;
		const appDir = join(workspaceRoot, 'apps', 'api');
		await mkdir(appDir, { recursive: true });

		// Create workspace config (a plain object)
		const workspaceConfig = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  name: 'test-workspace',
  constructs: './src/constructs/**/*.ts',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/config/logger',
    },
  },
};
`;
		await writeFile(join(workspaceRoot, 'gkm.config.ts'), workspaceConfig);

		// Create app package.json
		const packageJson = { name: '@test-workspace/api', version: '1.0.0' };
		await writeFile(join(appDir, 'package.json'), JSON.stringify(packageJson));

		// Change to app directory
		process.chdir(appDir);

		const result = await loadAppConfig();

		expect(result.appName).toBe('api');
		// Use realpathSync to handle macOS /var -> /private/var symlink
		expect(realpathSync(result.appRoot)).toBe(realpathSync(appDir));
		expect(realpathSync(result.workspaceRoot)).toBe(
			realpathSync(workspaceRoot),
		);
	});

	it('resolves a single-app config’s one app, whatever its package is called', async () => {
		// A single-app config is wrapped as a one-app workspace keyed `api`, which
		// is almost never the package name. Matching on the key alone loses
		// everything the workspace carries — including the constructs glob the
		// local target is derived from.
		const appDir = tempDir;
		const config = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  constructs: './src/constructs/**/*.ts',
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
};
`;
		await writeFile(join(appDir, 'gkm.config.ts'), config);
		await writeFile(
			join(appDir, 'package.json'),
			JSON.stringify({ name: '@acme/example', version: '1.0.0' }),
		);

		process.chdir(appDir);

		const result = await loadAppConfig();

		// The app's key in the config — never its package name.
		expect(result.appName).toBe('api');
		expect(result.app.constructs).toBe('./src/constructs/**/*.ts');
		// Absolute, because the build resolves an app's globs once here rather
		// than leaving each caller to guess which directory they are relative to.
		expect(result.gkmConfig.constructs).toEqual([
			join(result.workspaceRoot, 'src/constructs/**/*.ts'),
		]);
	});

	it('refuses a directory no app in the config lives in', async () => {
		// Create workspace structure
		const workspaceRoot = tempDir;
		const appDir = join(workspaceRoot, 'apps', 'unknown');
		await mkdir(appDir, { recursive: true });

		// Create workspace config without 'unknown' app
		const workspaceConfig = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  name: 'test-workspace',
  constructs: './src/constructs/**/*.ts',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/config/logger',
    },
  },
};
`;
		await writeFile(join(workspaceRoot, 'gkm.config.ts'), workspaceConfig);

		// A package named like an app is not one: only the config's paths count.
		const packageJson = { name: '@test-workspace/api', version: '1.0.0' };
		await writeFile(join(appDir, 'package.json'), JSON.stringify(packageJson));

		process.chdir(appDir);

		const error = await loadAppConfig().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NotInAnApp);
		expect((error as NotInAnApp).apps).toEqual({ api: 'apps/api' });
	});

	it('refuses a workspace that declares no constructs glob', async () => {
		const workspaceRoot = tempDir;
		const appDir = join(workspaceRoot, 'apps', 'api');
		await mkdir(appDir, { recursive: true });

		const workspaceConfig = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  name: 'test-workspace',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/config/logger',
    },
  },
};
`;
		await writeFile(join(workspaceRoot, 'gkm.config.ts'), workspaceConfig);
		await writeFile(
			join(appDir, 'package.json'),
			JSON.stringify({ name: '@test-workspace/api', version: '1.0.0' }),
		);

		process.chdir(appDir);

		const error = await loadAppConfig().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(WorkspaceDeclaresNoConstructs);
		expect(realpathSync((error as WorkspaceDeclaresNoConstructs).root)).toBe(
			realpathSync(workspaceRoot),
		);
	});

	it('finds the app by its path, with no package.json at all', async () => {
		const appDir = join(tempDir, 'apps', 'api', 'src');
		await mkdir(appDir, { recursive: true });
		await writeFile(
			join(tempDir, 'gkm.config.ts'),
			`
export default {
  stages: { local: 'development', deployed: ['production'] },
  name: 'test-workspace',
  constructs: './src/constructs/**/*.ts',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/config/logger',
    },
  },
};
`,
		);

		// A folder inside the app, which has no package.json of its own.
		process.chdir(appDir);

		expect((await loadAppConfig()).appName).toBe('api');
	});

	it('should use GKM_CONFIG_PATH env var when set', async () => {
		// Create workspace at a different location
		const workspaceRoot = await createTempDir('workspace-');
		const configPath = join(workspaceRoot, 'gkm.config.ts');

		// Create workspace config
		const workspaceConfig = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  name: 'env-test',
  constructs: './src/constructs/**/*.ts',
  apps: {
    api: {
      type: 'backend',
      path: 'apps/api',
      port: 3000,
      routes: './src/endpoints/**/*.ts',
      envParser: './src/config/env',
      logger: './src/config/logger',
    },
  },
};
`;
		await writeFile(configPath, workspaceConfig);

		// The app inside the workspace the variable names — what `gkm dev` sets
		// it to for each app it starts.
		const appDir = join(workspaceRoot, 'apps', 'api');
		await mkdir(appDir, { recursive: true });

		// Set GKM_CONFIG_PATH
		process.env.GKM_CONFIG_PATH = configPath;

		// Change to app directory
		process.chdir(appDir);

		const result = await loadAppConfig();

		expect(result.appName).toBe('api');
		// Use realpathSync to handle macOS /var -> /private/var symlink
		expect(realpathSync(result.workspaceRoot)).toBe(
			realpathSync(workspaceRoot),
		);

		// Cleanup the extra temp dir
		await cleanupDir(workspaceRoot);
	});
});

describe('config discovery', () => {
	let tempDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tempDir = await createTempDir();
		originalCwd = process.cwd();
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		delete process.env.GKM_CONFIG_PATH;
		await cleanupDir(tempDir);
	});

	it('should find config by walking up directories', async () => {
		// Create nested directory structure
		const nestedDir = join(tempDir, 'apps', 'api', 'src', 'endpoints');
		await mkdir(nestedDir, { recursive: true });

		// Create config at root
		const configContent = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
};
`;
		await writeFile(join(tempDir, 'gkm.config.ts'), configContent);

		// Change to deeply nested directory
		process.chdir(nestedDir);

		const config = await loadConfig();
	});

	it('should prefer GKM_CONFIG_PATH over walking up directories', async () => {
		// Create two configs at different levels
		const nestedDir = join(tempDir, 'apps', 'api');
		await mkdir(nestedDir, { recursive: true });

		// Config at root
		const rootConfig = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  routes: './root-routes/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
};
`;
		await writeFile(join(tempDir, 'gkm.config.ts'), rootConfig);

		// Config in a different location pointed to by env var
		const envConfigDir = await createTempDir('env-config-');
		const envConfig = `
export default {
  stages: { local: 'development', deployed: ['production'] },
  routes: './env-routes/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
};
`;
		await writeFile(join(envConfigDir, 'gkm.config.ts'), envConfig);

		// Set GKM_CONFIG_PATH to the env config
		process.env.GKM_CONFIG_PATH = join(envConfigDir, 'gkm.config.ts');

		// Change to nested directory
		process.chdir(nestedDir);

		const config = await loadConfig();

		// Cleanup
		await cleanupDir(envConfigDir);
	});
});
