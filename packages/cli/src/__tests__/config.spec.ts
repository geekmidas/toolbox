import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAppNameFromCwd, loadAppConfig, loadConfig } from '../config';
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

		expect(config.routes).toBe('./api/**/*.js');
		expect(config.envParser).toBe('./config/environment');
		expect(config.logger).toBe('./config/logging');
	});

	it('should handle configuration with only envParser override', async () => {
		const configContent = `
export default {
  envParser: './my-env#myEnvParser',
  logger: './my-logger#myLogger',
};
`;
		await writeFile(join(tempDir, 'gkm.config.ts'), configContent);

		const config = await loadConfig();

		expect(config.envParser).toBe('./my-env#myEnvParser');
		expect(config.logger).toBe('./my-logger#myLogger');
	});

	it('should handle malformed config file gracefully', async () => {
		const invalidConfigContent = `
export default {
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
  routes: './ts-routes/**/*.ts',
};
`;

		await writeFile(join(tempDir, 'gkm.config.js'), jsConfigContent);
		await writeFile(join(tempDir, 'gkm.config.ts'), tsConfigContent);

		const config = await loadConfig();

		expect(config.routes).toBe('./ts-routes/**/*.ts');
	});
});

describe('getAppNameFromCwd', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir();
	});

	afterEach(async () => {
		await cleanupDir(tempDir);
	});

	it('should return app name from package.json', async () => {
		const packageJson = { name: 'my-app', version: '1.0.0' };
		await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));

		const appName = getAppNameFromCwd(tempDir);

		expect(appName).toBe('my-app');
	});

	it('should extract name from scoped package', async () => {
		const packageJson = { name: '@myorg/api', version: '1.0.0' };
		await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));

		const appName = getAppNameFromCwd(tempDir);

		expect(appName).toBe('api');
	});

	it('should handle scoped package with nested scope', async () => {
		const packageJson = { name: '@my-company/auth-service', version: '1.0.0' };
		await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));

		const appName = getAppNameFromCwd(tempDir);

		expect(appName).toBe('auth-service');
	});

	it('should return null if package.json does not exist', async () => {
		const appName = getAppNameFromCwd(tempDir);

		expect(appName).toBeNull();
	});

	it('should return null if package.json has no name field', async () => {
		const packageJson = { version: '1.0.0' };
		await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson));

		const appName = getAppNameFromCwd(tempDir);

		expect(appName).toBeNull();
	});

	it('should return null if package.json is invalid JSON', async () => {
		await writeFile(join(tempDir, 'package.json'), 'not valid json');

		const appName = getAppNameFromCwd(tempDir);

		expect(appName).toBeNull();
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

		// Create workspace config (plain JS object with __isWorkspace marker)
		const workspaceConfig = `
export default {
  __isWorkspace: true,
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

		// Create app package.json
		const packageJson = { name: '@test-workspace/api', version: '1.0.0' };
		await writeFile(join(appDir, 'package.json'), JSON.stringify(packageJson));

		// Change to app directory
		process.chdir(appDir);

		const result = await loadAppConfig();

		expect(result.appName).toBe('api');
		expect(result.gkmConfig.routes).toBe('./src/endpoints/**/*.ts');
		// Use realpathSync to handle macOS /var -> /private/var symlink
		expect(realpathSync(result.appRoot)).toBe(realpathSync(appDir));
		expect(realpathSync(result.workspaceRoot)).toBe(
			realpathSync(workspaceRoot),
		);
	});

	it('should throw error if app not found in workspace', async () => {
		// Create workspace structure
		const workspaceRoot = tempDir;
		const appDir = join(workspaceRoot, 'apps', 'unknown');
		await mkdir(appDir, { recursive: true });

		// Create workspace config without 'unknown' app
		const workspaceConfig = `
export default {
  __isWorkspace: true,
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

		// Create app package.json with different name
		const packageJson = { name: '@test-workspace/unknown', version: '1.0.0' };
		await writeFile(join(appDir, 'package.json'), JSON.stringify(packageJson));

		// Change to app directory
		process.chdir(appDir);

		await expect(loadAppConfig()).rejects.toThrow(
			'App "unknown" not found in workspace config',
		);
	});

	it('should throw error if no package.json exists', async () => {
		// Create workspace structure without package.json in app
		const workspaceRoot = tempDir;
		const appDir = join(workspaceRoot, 'apps', 'api');
		await mkdir(appDir, { recursive: true });

		const workspaceConfig = `
export default {
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
};
`;
		await writeFile(join(workspaceRoot, 'gkm.config.ts'), workspaceConfig);

		// Change to app directory (no package.json)
		process.chdir(appDir);

		await expect(loadAppConfig()).rejects.toThrow(
			'Could not determine app name',
		);
	});

	it('should use GKM_CONFIG_PATH env var when set', async () => {
		// Create workspace at a different location
		const workspaceRoot = await createTempDir('workspace-');
		const configPath = join(workspaceRoot, 'gkm.config.ts');

		// Create workspace config
		const workspaceConfig = `
export default {
  __isWorkspace: true,
  name: 'env-test',
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

		// Create app directory in temp dir (separate from workspace)
		const appDir = join(tempDir, 'apps', 'api');
		await mkdir(appDir, { recursive: true });

		// Create app package.json
		const packageJson = { name: '@env-test/api', version: '1.0.0' };
		await writeFile(join(appDir, 'package.json'), JSON.stringify(packageJson));

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
  routes: './src/endpoints/**/*.ts',
  envParser: './src/config/env',
  logger: './src/config/logger',
};
`;
		await writeFile(join(tempDir, 'gkm.config.ts'), configContent);

		// Change to deeply nested directory
		process.chdir(nestedDir);

		const config = await loadConfig();

		expect(config.routes).toBe('./src/endpoints/**/*.ts');
	});

	it('should prefer GKM_CONFIG_PATH over walking up directories', async () => {
		// Create two configs at different levels
		const nestedDir = join(tempDir, 'apps', 'api');
		await mkdir(nestedDir, { recursive: true });

		// Config at root
		const rootConfig = `
export default {
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

		expect(config.routes).toBe('./env-routes/**/*.ts');

		// Cleanup
		await cleanupDir(envConfigDir);
	});
});
