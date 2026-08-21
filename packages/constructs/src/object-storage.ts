/**
 * `ObjectStorage` — a declared bucket.
 *
 * Where the three packages meet: it implements the construct contract, derives
 * its env key through `@geekmidas/manifest`, and hands back a
 * `@geekmidas/storage` client. It names no cloud — `--target=aws` fills the
 * injected URL with S3's values, local dev with MinIO's.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { createStorageClient, type StorageClient } from '@geekmidas/storage';
import type { Construct } from './construct-interface';

export interface ObjectStorageOptions {
	/** Keep previous versions of an object. */
	versioned?: boolean;
}

export class ObjectStorage<TName extends string = string>
	implements Construct<TName, StorageClient>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, StorageClient>;

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the key the
	 * build publishes and the key the client reads cannot drift — the whole point
	 * of the construct owning both faces.
	 */
	private readonly keys: { url: string };

	constructor(
		id: ConstructName<TName>,
		private readonly options: ObjectStorageOptions = {},
	) {
		// Canonicalises, so `uploads` and `Uploads` are one construct rather than
		// two that collide. Throws on anything that cannot become a valid id.
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.keys = { url: provideKey(canonical, 'url') };

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (options) => this.connect(options),
		};
	}

	declare(): Declaration[] {
		return [
			{
				kind: 'objects',
				id: this.id,
				provides: [this.keys.url],
				...(this.options.versioned ? { versioned: true } : {}),
			},
		];
	}

	/**
	 * Builds the client from the single URL the adapter supplied.
	 *
	 * The URL's scheme selects the driver, so this construct imports no provider
	 * and an app that never touches S3 never resolves the AWS SDK. Whoever
	 * assembles the application registers the drivers its target needs.
	 */
	private async connect({
		envParser,
	}: ServiceRegisterOptions): Promise<StorageClient> {
		const { url } = envParser
			.create((get) => ({ url: get(this.keys.url).string() }))
			.parse();

		return createStorageClient(url);
	}
}
