import { writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	checkDirectoryExists,
	detectPackageManager,
	findWorkspacePackages,
	findWorkspaceRoot,
	getExecCommand,
	getInstallCommand,
	getRunCommand,
	getWorkspaceGlobs,
	validateProjectName,
} from '../utils.js';

describe('validateProjectName', () => {
	it('should accept valid project names', () => {
		expect(validateProjectName('my-project')).toBe(true);
		expect(validateProjectName('my_project')).toBe(true);
		expect(validateProjectName('myProject')).toBe(true);
		expect(validateProjectName('my-project-123')).toBe(true);
		expect(validateProjectName('project')).toBe(true);
	});

	it('should reject empty names', () => {
		expect(validateProjectName('')).toBe('Project name is required');
	});

	it('should reject names with invalid characters', () => {
		const result = validateProjectName('my project');
		expect(result).toContain('can only contain');
	});

	it('rejects a name that swallowed a flag for want of a space', () => {
		expect(validateProjectName('shop--monorepo')).toBe(
			'"shop--monorepo" ends in the --monorepo flag. Did you mean `shop --monorepo`?',
		);
		expect(validateProjectName('shop--yes')).toContain('--yes flag');
	});

	it('accepts a double hyphen that is not a flag', () => {
		expect(validateProjectName('shop--web')).toBe(true);
	});

	it('should accept scoped package names', () => {
		// @ / . are valid for scoped npm packages
		expect(validateProjectName('@my/project')).toBe(true);
		expect(validateProjectName('my.project')).toBe(true);
	});

	it('should reject names with other special characters', () => {
		expect(validateProjectName('my$project')).toContain('can only contain');
		expect(validateProjectName('my#project')).toContain('can only contain');
		expect(validateProjectName('my!project')).toContain('can only contain');
	});
});

describe('checkDirectoryExists', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `cli-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('should return true for non-existent directory', () => {
		expect(checkDirectoryExists('non-existent-dir', tempDir)).toBe(true);
	});

	it('should return error for existing directory', async () => {
		const existingDir = 'existing-dir';
		await mkdir(join(tempDir, existingDir));
		const result = checkDirectoryExists(existingDir, tempDir);
		expect(result).toContain('already exists');
	});
});

describe('detectPackageManager', () => {
	let tempDir: string;
	let originalEnv: string | undefined;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `cli-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
		originalEnv = process.env.npm_config_user_agent;
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
		if (originalEnv !== undefined) {
			process.env.npm_config_user_agent = originalEnv;
		} else {
			delete process.env.npm_config_user_agent;
		}
	});

	it('should detect pnpm from user agent', () => {
		process.env.npm_config_user_agent = 'pnpm/8.0.0';
		expect(detectPackageManager(tempDir)).toBe('pnpm');
	});

	it('should detect yarn from user agent', () => {
		process.env.npm_config_user_agent = 'yarn/4.0.0';
		expect(detectPackageManager(tempDir)).toBe('yarn');
	});

	it('should detect bun from user agent', () => {
		process.env.npm_config_user_agent = 'bun/1.0.0';
		expect(detectPackageManager(tempDir)).toBe('bun');
	});

	it('should default to npm when no lockfile or user agent', () => {
		delete process.env.npm_config_user_agent;
		expect(detectPackageManager(tempDir)).toBe('npm');
	});
});

describe('detectPackageManager from a lockfile', () => {
	let dir: string;
	const agent = process.env.npm_config_user_agent;

	beforeEach(async () => {
		dir = join(tmpdir(), `gkm-pm-${Date.now()}-${Math.random()}`);
		await mkdir(dir, { recursive: true });
		// The lockfile is only read when no user agent names a manager.
		delete process.env.npm_config_user_agent;
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
		if (agent !== undefined) process.env.npm_config_user_agent = agent;
	});

	it.each([
		['yarn.lock', 'yarn'],
		['bun.lockb', 'bun'],
		['package-lock.json', 'npm'],
		['pnpm-lock.yaml', 'pnpm'],
	] as const)('reads %s as %s', (lockfile, pm) => {
		writeFileSync(join(dir, lockfile), '');
		expect(detectPackageManager(dir)).toBe(pm);
	});
});

describe('validateProjectName, reserved names', () => {
	it('refuses a name that would shadow a project file', () => {
		expect(validateProjectName('src')).toBe('"src" is a reserved name');
		expect(validateProjectName('Package.json')).toBe(
			'"Package.json" is a reserved name',
		);
	});
});

describe('package manager commands', () => {
	it.each([
		['pnpm', 'pnpm install', 'pnpm dev', 'pnpm exec biome'],
		['yarn', 'yarn', 'yarn dev', 'yarn biome'],
		['bun', 'bun install', 'bun run dev', 'bunx biome'],
		['npm', 'npm install', 'npm run dev', 'npx --no-install biome'],
	] as const)('%s installs, runs and executes its own way', (pm, install, run, exec) => {
		expect(getInstallCommand(pm)).toBe(install);
		expect(getRunCommand(pm, 'dev')).toBe(run);
		expect(getExecCommand(pm, 'biome')).toBe(exec);
	});
});

describe('workspace discovery', () => {
	let root: string;

	beforeEach(async () => {
		root = join(tmpdir(), `gkm-ws-${Date.now()}-${Math.random()}`);
		await mkdir(join(root, 'apps/api/src'), { recursive: true });
		await mkdir(join(root, 'packages/models'), { recursive: true });
		writeFileSync(join(root, 'apps/api/package.json'), '{"name":"@x/api"}');
		writeFileSync(
			join(root, 'packages/models/package.json'),
			'{"name":"@x/models"}',
		);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('finds a pnpm workspace by its pnpm-workspace.yaml', () => {
		writeFileSync(
			join(root, 'pnpm-workspace.yaml'),
			"packages:\n  - 'apps/*'\n  - 'packages/*'\n",
		);
		writeFileSync(join(root, 'package.json'), '{"name":"x"}');

		expect(findWorkspaceRoot(join(root, 'apps/api/src'), 'pnpm')).toBe(root);
		expect(getWorkspaceGlobs(root)).toEqual(['apps/*', 'packages/*']);
		expect(
			findWorkspacePackages(join(root, 'apps/api'), 'pnpm').sort(),
		).toEqual(
			[
				join(root, 'apps/api/package.json'),
				join(root, 'package.json'),
				join(root, 'packages/models/package.json'),
			].sort(),
		);
	});

	it('finds an npm or yarn workspace by package.json#workspaces', () => {
		writeFileSync(
			join(root, 'package.json'),
			'{"name":"x","workspaces":["apps/*"]}',
		);

		expect(findWorkspaceRoot(join(root, 'apps/api'), 'npm')).toBe(root);
		expect(getWorkspaceGlobs(root)).toEqual(['apps/*']);
	});

	it('reads the object form of workspaces', () => {
		writeFileSync(
			join(root, 'package.json'),
			'{"name":"x","workspaces":{"packages":["packages/*"]}}',
		);

		expect(getWorkspaceGlobs(root)).toEqual(['packages/*']);
	});

	it('falls back to the lockfile, and skips a package.json it cannot parse', () => {
		writeFileSync(join(root, 'apps/api/package.json'), '{ not json');
		writeFileSync(join(root, 'yarn.lock'), '');

		expect(findWorkspaceRoot(join(root, 'apps/api'), 'yarn')).toBe(root);
	});

	it('is the directory itself when nothing marks a root above it', () => {
		const lone = join(root, 'apps/api/src');
		expect(findWorkspaceRoot(lone, 'bun')).toBe(lone);
		expect(getWorkspaceGlobs(lone)).toEqual([]);
		expect(getWorkspaceGlobs(join(root, 'apps/api'))).toEqual([]);
	});
});
