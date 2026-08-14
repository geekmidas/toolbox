import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Load package.json - handles both bundled (flat dist/) and source (nested src/init/)
function loadPackageJson(): { version: string } {
	try {
		// Try flat dist path first (../package.json from dist/)
		return require('../package.json');
	} catch {
		// Fall back to nested source path (../../package.json from src/init/)
		return require('../../package.json');
	}
}

const pkg = loadPackageJson();

/**
 * CLI version resolved from package.json at runtime
 */
export const CLI_VERSION = `~${pkg.version}`;

/**
 * Package versions for @geekmidas packages
 *
 * AUTO-GENERATED (except CLI) - Do not edit manually
 * Run: pnpm --filter @geekmidas/cli sync-versions
 */
export const GEEKMIDAS_VERSIONS = {
	'@geekmidas/audit': '~9.0.2',
	'@geekmidas/auth': '~9.0.2',
	'@geekmidas/cache': '~9.0.2',
	'@geekmidas/client': '~9.0.2',
	'@geekmidas/cloud': '~9.0.2',
	'@geekmidas/constructs': '~9.0.2',
	'@geekmidas/db': '~9.0.2',
	'@geekmidas/emailkit': '~9.0.2',
	'@geekmidas/envkit': '~9.0.2',
	'@geekmidas/errors': '~9.0.2',
	'@geekmidas/events': '~9.0.2',
	'@geekmidas/logger': '~9.0.2',
	'@geekmidas/rate-limit': '~9.0.2',
	'@geekmidas/schema': '~9.0.2',
	'@geekmidas/services': '~9.0.2',
	'@geekmidas/storage': '~9.0.2',
	'@geekmidas/studio': '~9.0.2',
	'@geekmidas/telescope': '~9.0.2',
	'@geekmidas/testkit': '~9.0.2',
	'@geekmidas/cli': CLI_VERSION,
} as const;

export type GeekmidasPackage = keyof typeof GEEKMIDAS_VERSIONS;
