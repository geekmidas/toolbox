/**
 * Driver registry — how a storage URL becomes a client without the caller
 * naming a cloud.
 *
 * A construct declares that it needs object storage and receives one URL. It
 * must not import `AmazonStorageClient` to use it: that would name a provider in
 * the neutral layer and drag the AWS SDK into an app that only ever talks to
 * GCS. So the protocol selects the driver, and whoever assembles the
 * application decides which drivers exist — a generated handler registering the
 * one its target needs, or a dev entry registering several.
 *
 * Registration is explicit rather than an import side effect, because a
 * side-effecting module is exactly what a bundler is entitled to drop.
 */

import { UnregisteredStorageScheme } from './errors';
import type { StorageClient } from './StorageClient';

/**
 * Builds a client from a URL it recognises.
 *
 * The driver owns parsing: the shape of an `s3://` URL is S3's business, and a
 * `gs://` driver shares nothing with it beyond this signature.
 */
export interface StorageDriver {
	/** The URL scheme this driver handles, including the colon — e.g. `'s3:'`. */
	readonly scheme: string;
	create(url: string): StorageClient;
}

const drivers = new Map<string, StorageDriver>();

/** Make a driver available to {@link createStorageClient}. Idempotent. */
export function registerStorageDriver(driver: StorageDriver): void {
	drivers.set(driver.scheme, driver);
}

/** Which schemes are currently registered — the useful half of a failure. */
export function registeredStorageSchemes(): string[] {
	return [...drivers.keys()].sort();
}

/**
 * Build a client for a URL.
 *
 * @throws {UnregisteredStorageScheme} when no driver handles the scheme, which
 * in practice means the build pinned a different one, or nothing registered.
 */
export function createStorageClient(url: string): StorageClient {
	const scheme = schemeOf(url);
	const driver = drivers.get(scheme);

	if (!driver) {
		throw new UnregisteredStorageScheme(
			url,
			scheme,
			registeredStorageSchemes(),
		);
	}

	return driver.create(url);
}

function schemeOf(url: string): string {
	const separator = url.indexOf(':');
	return separator === -1 ? '' : url.slice(0, separator + 1);
}
