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
	'@geekmidas/audit': '~1.0.0',
	'@geekmidas/auth': '~1.0.0',
	'@geekmidas/cache': '~1.0.0',
	'@geekmidas/client': '~2.0.0',
	'@geekmidas/cloud': '~1.0.0',
	'@geekmidas/constructs': '~1.1.0',
	'@geekmidas/db': '~1.0.0',
	'@geekmidas/emailkit': '~1.0.0',
	'@geekmidas/envkit': '~1.0.2',
	'@geekmidas/errors': '~1.0.0',
	'@geekmidas/events': '~1.0.0',
	'@geekmidas/logger': '~1.0.0',
	'@geekmidas/rate-limit': '~1.0.0',
	'@geekmidas/schema': '~1.0.0',
	'@geekmidas/services': '~1.0.1',
	'@geekmidas/storage': '~1.0.0',
	'@geekmidas/studio': '~1.0.0',
	'@geekmidas/telescope': '~1.0.0',
	'@geekmidas/testkit': '~1.0.1',
	'@geekmidas/cli': CLI_VERSION,
} as const;

export type GeekmidasPackage = keyof typeof GEEKMIDAS_VERSIONS;
