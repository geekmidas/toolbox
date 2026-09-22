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
	'@geekmidas/audit': '~10.0.0-alpha.3',
	'@geekmidas/auth': '~10.0.0-alpha.3',
	'@geekmidas/cache': '~10.0.0-alpha.3',
	'@geekmidas/client': '~10.0.0-alpha.3',
	'@geekmidas/cloud': '~10.0.0-alpha.3',
	'@geekmidas/constructs': '~10.0.0-alpha.3',
	'@geekmidas/db': '~10.0.0-alpha.3',
	'@geekmidas/emailkit': '~10.0.0-alpha.3',
	'@geekmidas/envkit': '~10.0.0-alpha.3',
	'@geekmidas/errors': '~10.0.0-alpha.3',
	'@geekmidas/events': '~10.0.0-alpha.3',
	'@geekmidas/logger': '~10.0.0-alpha.3',
	'@geekmidas/manifest': '~10.0.0-alpha.3',
	'@geekmidas/rate-limit': '~10.0.0-alpha.3',
	'@geekmidas/schema': '~10.0.0-alpha.3',
	'@geekmidas/services': '~10.0.0-alpha.3',
	'@geekmidas/storage': '~10.0.0-alpha.3',
	'@geekmidas/studio': '~10.0.0-alpha.3',
	'@geekmidas/telescope': '~10.0.0-alpha.3',
	'@geekmidas/testkit': '~10.0.0-alpha.3',
	'@geekmidas/cli': CLI_VERSION,
} as const;

export type GeekmidasPackage = keyof typeof GEEKMIDAS_VERSIONS;
