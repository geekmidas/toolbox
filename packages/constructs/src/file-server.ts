/**
 * `FileServer` — a domain that serves a bucket's objects.
 *
 * `ObjectStorage` is the bucket: it writes, it presigns, and its URL is never
 * public. Serving those objects on a domain is a different thing, and it is a
 * construct of its own rather than a flag on the bucket — see
 * `docs/design/constructs-paradigm.md`, "Why a separate construct, and what it
 * costs", for the comparison that rules the other two shapes out.
 *
 * ```ts
 * export const uploads = new FileServer('Uploads', { open: ['brand/**'] });
 *
 * uploads.getUploadURL({ path, contentType })  // an S3 presign at the bucket
 * uploads.url('brand/logo.png')                // open path — no signature
 * uploads.signedUrl('invoices/7.pdf')          // one object, one recipient
 * ```
 *
 * **One construct, one client, both halves.** How a file lands in the bucket is
 * the same whether or not it is served, so splitting the upload half from the
 * serving half would be ceremony rather than safety. The client is a *superset*
 * of `StorageClient`, made literal in the type, so anything taking
 * `services.uploads` keeps compiling when the construct behind it grows a
 * serving half.
 *
 * **The id names the bucket, not the surface.** This is the detail that has to
 * be right before anything ships, because getting it backwards is destructive:
 * the migration people actually perform is serving a bucket they already have,
 * and naming the bucket after the construct makes that edit *add* a node rather
 * than rename the one holding the data.
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
import type { Construct, Declarable } from './construct-interface';

/**
 * A key an open pattern admits.
 *
 * The same template-literal trick `ConstructName` uses, so `open` is checked at
 * the call site rather than only at the edge:
 *
 * ```ts
 * files.url('brand/logo.png')       // ok
 * files.url(`avatars/${id}.png`)    // ok — a template literal still matches
 * files.url('invoices/7.pdf')       // not assignable — never served unsigned
 * ```
 *
 * A single star and a double star resolve to the same type, stated rather than
 * discovered: a template literal cannot exclude `/`, so this is a prefix-and-
 * suffix guard while the *exact* pattern is enforced by the bucket policy, by
 * the cache behaviour, and by this construct's own runtime check. The type says
 * plausibly open; the infrastructure says definitely.
 */
export type Served<P extends string> = P extends `${infer Head}**`
	? `${Head}${string}`
	: P extends `${infer Head}*${infer Tail}`
		? `${Head}${string}${Tail}`
		: P;

/** What consuming a file server hands you: a bucket client that also serves. */
export interface FileServerClient<TOpen extends string = never>
	extends StorageClient {
	/**
	 * The unsigned address of an open object.
	 *
	 * Compile-checked against the declared patterns, *and* checked again at
	 * runtime — a JavaScript caller gets no compiler, and minting an unsigned
	 * URL for a private object is a leak rather than a mistake.
	 *
	 * @throws {NotOpen} when the key matches no declared pattern.
	 */
	url(key: Served<TOpen>): string;

	/**
	 * The same thing for a key the compiler cannot see.
	 *
	 * A fully dynamic key does not type, which is correct and is also the case
	 * people will hit — so the escape hatch is a named method rather than a
	 * cast, and it runs the *same* runtime check rather than being a way around
	 * it.
	 *
	 * @throws {NotOpen} when the key matches no declared pattern.
	 */
	openUrl(key: string): string;

	/**
	 * A signed address for one object and one recipient.
	 *
	 * Today this is an **S3 presign at the bucket**, which is what works
	 * unchanged against MinIO locally and against S3 deployed. It is deliberately
	 * not described as a CDN URL: CloudFront signing is a different mechanism,
	 * with different keys, against a different host, and it needs key material
	 * this construct does not yet declare.
	 *
	 * @param expiresIn - minutes, matching `getUploadURL`.
	 */
	signedUrl(key: string, expiresIn?: number): Promise<string>;
}

export interface FileServerOptions<TOpen extends string = never> {
	/**
	 * Paths served without a signature. Everything else needs one.
	 *
	 * Private by default: a bucket where forgetting a flag publishes user
	 * uploads is the wrong default, so this is an exception list, and listing it
	 * in code means exactly one set of paths is unauthenticated and it is
	 * reviewable in a diff.
	 *
	 * Uploading is deliberately *not* restricted to these. Writing to a path
	 * that happens to be open is ordinary; the only asymmetry worth enforcing is
	 * that you cannot hand out an unsigned URL for something the server would
	 * refuse to serve unsigned.
	 */
	open?: readonly TOpen[];
	/** Keep previous versions of an object. */
	versioned?: boolean;
	/**
	 * A bucket declared elsewhere, instead of one of this server's own.
	 *
	 * `new FileServer('Uploads')` declares both nodes; this fronts a bucket that
	 * already exists, which is also how the two edges come back when you want
	 * them separately — a handler depending on the bucket writes, a handler
	 * depending on the server mints URLs.
	 */
	origin?: Declarable;
}

/** A key was asked to be served unsigned, and no open pattern admits it. */
export class NotOpen extends Error {
	constructor(
		readonly key: string,
		readonly open: readonly string[],
	) {
		super(
			`'${key}' is not served without a signature. ` +
				(open.length
					? `Open paths: ${open.join(', ')}. Use signedUrl() for anything else.`
					: 'This file server declares no open paths, so every object needs signedUrl().'),
		);
		this.name = 'NotOpen';
	}
}

export class FileServer<
	TName extends string = string,
	TOpen extends string = never,
> implements Construct<TName, FileServerClient<TOpen>>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, FileServerClient<TOpen>>;

	/** The id of the surface node, as opposed to the bucket's. */
	readonly surfaceId: string;

	private readonly open: readonly string[];

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the keys the
	 * target publishes and the keys the client reads cannot drift.
	 */
	private readonly keys: { origin: string; server: string };

	constructor(
		id: ConstructName<TName>,
		private readonly options: FileServerOptions<TOpen> = {},
	) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.open = options.open ?? [];

		// The surface takes the suffix and the bucket keeps the plain id, which
		// is what makes "serve a bucket I already have" an edit that adds a node
		// instead of renaming the one holding the data.
		const originId = options.origin?.id ?? canonical;
		this.surfaceId = `${canonical}Server`;

		this.keys = {
			origin: provideKey(originId, 'url'),
			server: provideKey(this.surfaceId, 'url'),
		};

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (registerOptions) => this.connect(registerOptions),
		};
	}

	/**
	 * The bucket and the surface over it — or just the surface, when the bucket
	 * was declared elsewhere.
	 *
	 * The surface names its origin through `of`, which is what makes the
	 * reference check work: an origin resolving to nothing is a build failure,
	 * the same guarantee `assertDerivations` already gives a reader and a schema
	 * tenant.
	 */
	declare(): Declaration[] {
		const origin = this.options.origin;

		const surface: Declaration = {
			kind: 'file-server',
			id: this.surfaceId,
			of: origin?.id ?? this.id,
			...(this.open.length ? { open: this.open } : {}),
			provides: [this.keys.server],
		};

		// A vended bucket is declared here; a given one already declares itself,
		// and declaring it twice is the duplication the whole model removes.
		if (origin) return [surface];

		return [
			{
				kind: 'objects',
				id: this.id,
				provides: [this.keys.origin],
				...(this.options.versioned ? { versioned: true } : {}),
			},
			surface,
		];
	}

	/**
	 * The bucket's client, with the serving half added.
	 *
	 * Both addresses are read here, which is also how the environment reaches a
	 * handler: the sniffer records what this reads, so `.dependsOn([uploads])`
	 * carries the bucket URL and the server URL without either being written
	 * down beside the handler.
	 */
	private async connect(
		options: ServiceRegisterOptions,
	): Promise<FileServerClient<TOpen>> {
		const { origin, server } = options.envParser
			.create((get) => ({
				origin: get(this.keys.origin).string(),
				server: get(this.keys.server).string(),
			}))
			.parse();

		const storage = createStorageClient(origin);
		const base = server.replace(/\/+$/, '');

		const serve = (key: string): string => {
			if (!this.serves(key)) throw new NotOpen(key, this.open);

			return `${base}/${key.replace(/^\/+/, '')}`;
		};

		// Delegating rather than copying: the bucket half is whatever the driver
		// produced, including anything it grows later, and only the serving half
		// is added on top.
		return Object.assign(Object.create(storage) as StorageClient, {
			url: serve as (key: Served<TOpen>) => string,
			openUrl: serve,
			signedUrl: (key: string, expiresIn?: number) =>
				storage.getDownloadURL({ path: key } as never, expiresIn),
		}) as FileServerClient<TOpen>;
	}

	/**
	 * Whether an open pattern admits a key.
	 *
	 * The runtime half of {@link Served}, and stricter than it: here a single
	 * star stops at a segment boundary and a double star does not, which is the
	 * distinction a template-literal type cannot draw and the infrastructure
	 * does.
	 */
	private serves(key: string): boolean {
		return this.open.some((pattern) => globToRegExp(pattern).test(key));
	}
}

/**
 * One open pattern as an anchored expression.
 *
 * A double star crosses `/`; a single star does not. Both are consumed in one
 * left-to-right pass rather than by substitution, so a pattern cannot be
 * rewritten into a placeholder that a later pass mistakes for literal text.
 */
function globToRegExp(pattern: string): RegExp {
	let source = '';

	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index];

		if (character !== '*') {
			source += character?.replace(/[.+^${}()|[\]\\?]/, '\\$&') ?? '';
			continue;
		}

		if (pattern[index + 1] === '*') {
			source += '.*';
			index++;
			continue;
		}

		source += '[^/]*';
	}

	return new RegExp(`^${source}$`);
}
