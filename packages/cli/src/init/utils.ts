import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
    case 'npm':
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
    case 'npm':
    default:
      return `npm run ${script}`;
  }
}
