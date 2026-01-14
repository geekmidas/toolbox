/**
 * Current released versions of @geekmidas packages
 * Update these when publishing new versions
 */
export const GEEKMIDAS_VERSIONS = {
	'@geekmidas/audit': '~0.18.0',
	'@geekmidas/auth': '~0.18.0',
	'@geekmidas/cache': '~0.18.0',
	'@geekmidas/cli': '~0.18.0',
	'@geekmidas/client': '~0.18.0',
	'@geekmidas/cloud': '~0.18.0',
	'@geekmidas/constructs': '~0.18.0',
	'@geekmidas/db': '~0.18.0',
	'@geekmidas/emailkit': '~0.18.0',
	'@geekmidas/envkit': '~0.18.0',
	'@geekmidas/errors': '~0.18.0',
	'@geekmidas/events': '~0.18.0',
	'@geekmidas/logger': '~0.18.0',
	'@geekmidas/rate-limit': '~0.18.0',
	'@geekmidas/schema': '~0.18.0',
	'@geekmidas/services': '~0.18.0',
	'@geekmidas/storage': '~0.18.0',
	'@geekmidas/studio': '~0.18.0',
	'@geekmidas/telescope': '~0.18.0',
	'@geekmidas/testkit': '~0.18.0',
} as const;

export type GeekmidasPackage = keyof typeof GEEKMIDAS_VERSIONS;

/**
 * Get the version for a @geekmidas package
 */
export function getPackageVersion(pkg: GeekmidasPackage): string {
	return GEEKMIDAS_VERSIONS[pkg];
}
