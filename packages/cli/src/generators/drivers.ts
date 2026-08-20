/**
 * Driver registration for generated entry points.
 *
 * A construct declares that it needs object storage and is handed one URL; the
 * scheme in that URL picks the driver that builds the client. Which drivers
 * exist is therefore the *entry point's* decision, not the construct's and not
 * the application's — an app that never talks to S3 should never resolve the AWS
 * SDK, and application code that registers a driver has named a provider in the
 * one layer this design keeps provider-free.
 *
 * So the generated entries register: `gkm dev`'s server for local development,
 * and each Lambda handler for its own target. Registration is an explicit call
 * rather than an import side effect, because a side-effecting module is exactly
 * what a bundler is entitled to drop.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The `s3://` driver, which serves MinIO locally and S3 deployed. */
const S3 = {
	imports: `import { registerStorageDriver } from '@geekmidas/storage';\nimport { s3Driver } from '@geekmidas/storage/aws';`,
	setup: 'registerStorageDriver(s3Driver);',
};

/** What a generated entry needs in order to register the drivers it uses. */
export interface StorageDrivers {
	/** Import lines, or `''` when there is nothing to register. */
	imports: string;
	/** The registration calls, or `''`. */
	setup: string;
}

const NONE: StorageDrivers = { imports: '', setup: '' };

/**
 * The drivers an app's entry points should register.
 *
 * Keyed off the dependency rather than off a declared bucket, because the entry
 * is generated before discovery has run on the watcher's rebuild path — and an
 * app that installed `@geekmidas/storage` has already paid for the SDK it would
 * otherwise resolve lazily.
 */
export function storageDriversFor(appRoot: string): StorageDrivers {
	return dependsOnStorage(appRoot) ? S3 : NONE;
}

function dependsOnStorage(appRoot: string): boolean {
	const manifest = join(appRoot, 'package.json');
	if (!existsSync(manifest)) return false;

	try {
		const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};

		return Boolean(
			pkg.dependencies?.['@geekmidas/storage'] ??
				pkg.devDependencies?.['@geekmidas/storage'],
		);
	} catch {
		// An unreadable package.json is the build's problem, not this function's.
		return false;
	}
}
