import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
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
