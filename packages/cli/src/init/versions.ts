import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Path is ../package.json from dist/ (bundled output is flat)
const pkg = require('../package.json') as { version: string };

/**
 * CLI version from package.json (used for scaffolded projects)
 */
export const CLI_VERSION = `~${pkg.version}`;

/**
 * Current released versions of @geekmidas packages
 * Update these when publishing new versions
 * Note: CLI version is read from package.json via CLI_VERSION
 */
export const GEEKMIDAS_VERSIONS = {
	'@geekmidas/audit': '~0.2.0',
	'@geekmidas/auth': '~0.2.0',
	'@geekmidas/cache': '~0.2.0',
	'@geekmidas/cli': CLI_VERSION,
	'@geekmidas/client': '~0.5.0',
	'@geekmidas/cloud': '~0.2.0',
	'@geekmidas/constructs': '~0.6.0',
	'@geekmidas/db': '~0.3.0',
	'@geekmidas/emailkit': '~0.2.0',
	'@geekmidas/envkit': '~0.4.0',
	'@geekmidas/errors': '~0.1.0',
	'@geekmidas/events': '~0.2.0',
	'@geekmidas/logger': '~0.4.0',
	'@geekmidas/rate-limit': '~0.3.0',
	'@geekmidas/schema': '~0.1.0',
	'@geekmidas/services': '~0.2.0',
	'@geekmidas/storage': '~0.1.0',
	'@geekmidas/studio': '~0.4.0',
	'@geekmidas/telescope': '~0.4.0',
	'@geekmidas/testkit': '~0.6.0',
};

export type GeekmidasPackage = keyof typeof GEEKMIDAS_VERSIONS;

/**
 * Get the version for a @geekmidas package
 */
export function getPackageVersion(pkg: GeekmidasPackage): string {
	return GEEKMIDAS_VERSIONS[pkg]!;
}
