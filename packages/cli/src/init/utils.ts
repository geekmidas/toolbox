import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/**
 * Detect the package manager being used based on lockfiles or npm_config_user_agent
 */
export function detectPackageManager(
	cwd: string = process.cwd(),
): PackageManager {
	// Check for lockfiles in cwd
	if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
	if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
	if (existsSync(join(cwd, 'bun.lockb'))) return 'bun';
	if (existsSync(join(cwd, 'package-lock.json'))) return 'npm';

	// Check npm_config_user_agent (set when running via npx/pnpm dlx/etc)
	const userAgent = process.env.npm_config_user_agent || '';
	if (userAgent.includes('pnpm')) return 'pnpm';
	if (userAgent.includes('yarn')) return 'yarn';
	if (userAgent.includes('bun')) return 'bun';

	return 'npm';
}

/**
 * Validate project name for npm package naming conventions
 */
export function validateProjectName(name: string): boolean | string {
	if (!name) {
		return 'Project name is required';
	}

	// Check for valid npm package name characters
	if (!/^[a-z0-9-_@/.]+$/i.test(name)) {
		return 'Project name can only contain letters, numbers, hyphens, underscores, @, /, and .';
	}

	// Check for reserved names
	const reserved = ['node_modules', '.git', 'package.json', 'src'];
	if (reserved.includes(name.toLowerCase())) {
		return `"${name}" is a reserved name`;
	}

	return true;
}

/**
 * Check if a directory already exists at the target path
 */
export function checkDirectoryExists(
	name: string,
	cwd: string = process.cwd(),
): boolean | string {
	const targetPath = join(cwd, name);
	if (existsSync(targetPath)) {
		return `Directory "${name}" already exists`;
	}
	return true;
}

/**
 * Get the install command for a package manager
 */
export function getInstallCommand(pkgManager: PackageManager): string {
	switch (pkgManager) {
		case 'pnpm':
			return 'pnpm install';
		case 'yarn':
			return 'yarn';
		case 'bun':
			return 'bun install';
		default:
			return 'npm install';
	}
}

/**
 * Get the dev command for a package manager
 */
export function getRunCommand(
	pkgManager: PackageManager,
	script: string,
): string {
	switch (pkgManager) {
		case 'pnpm':
			return `pnpm ${script}`;
		case 'yarn':
			return `yarn ${script}`;
		case 'bun':
			return `bun run ${script}`;
		default:
			return `npm run ${script}`;
	}
}

const lockfileByPm: Record<PackageManager, string> = {
	pnpm: 'pnpm-lock.yaml',
	yarn: 'yarn.lock',
	npm: 'package-lock.json',
	bun: 'bun.lockb',
};

/**
 * Find the workspace/project root by walking up from cwd.
 * Checks for PM-specific workspace config, package.json#workspaces,
 * and lockfiles.
 */
export function findWorkspaceRoot(cwd: string, pm: PackageManager): string {
	let dir = cwd;
	const root = parse(dir).root;
	const lockfile = lockfileByPm[pm];

	while (dir !== root) {
		if (pm === 'pnpm' && existsSync(join(dir, 'pnpm-workspace.yaml'))) {
			return dir;
		}

		const pkgJsonPath = join(dir, 'package.json');
		if (existsSync(pkgJsonPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
				if (pkg.workspaces) return dir;
			} catch {
				// ignore malformed package.json
			}
		}

		if (existsSync(join(dir, lockfile))) {
			return dir;
		}

		dir = dirname(dir);
	}

	return cwd;
}

/**
 * Get workspace package glob patterns from pnpm-workspace.yaml
 * or package.json#workspaces.
 */
export function getWorkspaceGlobs(root: string): string[] {
	const pnpmWorkspacePath = join(root, 'pnpm-workspace.yaml');
	if (existsSync(pnpmWorkspacePath)) {
		const content = readFileSync(pnpmWorkspacePath, 'utf-8');
		const parsed = parseYaml(content);
		return parsed?.packages ?? [];
	}

	const rootPkgJsonPath = join(root, 'package.json');
	if (existsSync(rootPkgJsonPath)) {
		const pkg = JSON.parse(readFileSync(rootPkgJsonPath, 'utf-8'));
		if (Array.isArray(pkg.workspaces)) {
			return pkg.workspaces;
		}
		if (pkg.workspaces?.packages) {
			return pkg.workspaces.packages;
		}
	}

	return [];
}

/**
 * Find all package.json files across a workspace.
 * Returns the root package.json plus all workspace member package.json paths.
 */
export function findWorkspacePackages(
	cwd: string,
	pm: PackageManager,
): string[] {
	const workspaceRoot = findWorkspaceRoot(cwd, pm);
	const results: string[] = [];

	const rootPkgJson = join(workspaceRoot, 'package.json');
	if (existsSync(rootPkgJson)) {
		results.push(rootPkgJson);
	}

	const globs = getWorkspaceGlobs(workspaceRoot);

	for (const glob of globs) {
		const pattern = `${glob}/package.json`;
		const matches = fg.sync(pattern, {
			cwd: workspaceRoot,
			absolute: true,
			ignore: ['**/node_modules/**'],
		});
		results.push(...matches);
	}

	return [...new Set(results)];
}
