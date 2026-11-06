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
	providedKeyFor,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { createStorageClient, type StorageClient } from '@geekmidas/storage';
import {
	type Construct,
	type ServerHalf,
	serverHalfOf,
} from './construct-interface';
import { expiryDays, type ObjectExpiry } from './expire';
import { readOnlyStorage } from './readOnlyStorage';

export {
	ExpiryDaysInvalid,
	ExpiryPrefixInvalid,
	type ObjectExpiry,
} from './expire';

export interface ObjectStorageOptions {
	/** Keep previous versions of an object. */
	versioned?: boolean;
	/**
	 * Delete the objects under each prefix this many days after they were
	 * written — `{ 'quotes/': { days: 30 } }`.
	 */
	expire?: ObjectExpiry;
}

/**
 * A bucket method called on a client that holds no connection — a site's or
 * a mobile app's plain edge, which holds where the bucket's links are signed
 * and nothing that writes to it.
 */
export class ObjectStorageReadOnly extends Error {
	constructor(
		readonly id: string,
		readonly method: string,
		readonly key: string,
	) {
		super(
			`'${id}' cannot ${method}(): ${key} is not in this process's ` +
				`environment. A site's or app's plain edge to a bucket holds only ` +
				`where its links are signed. A server half that uploads, presigns ` +
				`or reads depends on '${id}'.server instead — ` +
				`.dependsOn([${id.charAt(0).toLowerCase()}${id.slice(1)}.server]).`,
		);
		this.name = 'ObjectStorageReadOnly';
	}
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
	private readonly keys: { connectionString: string };

	/** Checked once, at declaration: prefix → days. */
	private readonly expire: Record<string, number> | undefined;

	constructor(
		id: ConstructName<TName>,
		private readonly options: ObjectStorageOptions = {},
	) {
		// Canonicalises, so `uploads` and `Uploads` are one construct rather than
		// two that collide. Throws on anything that cannot become a valid id.
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.keys = {
			connectionString: providedKeyFor(
				canonical,
				'objects',
				'connectionString',
			),
		};
		this.expire = expiryDays(canonical, options.expire);

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
				provides: [this.keys.connectionString],
				...(this.options.versioned ? { versioned: true } : {}),
				...(this.expire ? { expire: this.expire } : {}),
			},
		];
	}

	/**
	 * The bucket, its connection and the key pair that signs for it, for a
	 * site's or a mobile app's server half that uploads or presigns:
	 * `.dependsOn([documents.server])`.
	 *
	 * A frontend's plain `.dependsOn([documents])` holds where the bucket's
	 * links are signed (`DOCUMENTS_SIGNED_ORIGIN`, inlined as
	 * `<PREFIX>DOCUMENTS_SIGNED_ORIGIN`) and nothing that writes to it. A
	 * backend's plain edge is already this one, and a backend cannot name it:
	 * it is a `Declarable`, not a `Consumable`.
	 */
	get server(): ServerHalf {
		return serverHalfOf(this);
	}

	/**
	 * Builds the client from the connection string the adapter supplied —
	 * or, where none was, a client whose every method throws
	 * {@link ObjectStorageReadOnly}.
	 *
	 * Its scheme selects the driver, so this construct imports no provider
	 * and an app that never touches S3 never resolves the AWS SDK. Whoever
	 * assembles the application registers the drivers its target needs.
	 */
	private async connect({
		envParser,
	}: ServiceRegisterOptions): Promise<StorageClient> {
		const { connectionString } = envParser
			.create((get) => ({
				connectionString: get(this.keys.connectionString).string().optional(),
			}))
			.parse();

		// A frontend's plain edge holds no connection, so its client has
		// nothing to call: every method says to depend on `.server`.
		if (!connectionString) {
			return readOnlyStorage(
				(method) =>
					new ObjectStorageReadOnly(
						this.id,
						method,
						this.keys.connectionString,
					),
			);
		}

		return createStorageClient(connectionString);
	}
}
