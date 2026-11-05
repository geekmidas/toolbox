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

import type { Logger } from '@geekmidas/logger';
import { DEFAULT_LOGGER } from '@geekmidas/logger/console';
import {
	type ConstructName,
	canonicalId,
	DERIVED_PREFIX,
	type Declaration,
	fileServerSurfaceId,
	providedKeyFor,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { createStorageClient, type StorageClient } from '@geekmidas/storage';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	Construct,
	Declarable,
	HasPublicFace,
} from './construct-interface';
import { expiryDays, type ObjectExpiry } from './expire';
import type { Processor } from './processors/Processor';
import { ProcessorBuilder } from './processors/ProcessorBuilder';
import {
	fillPattern,
	type PatternParams,
	parsePattern,
} from './processors/pattern';
import type { Telemetry } from './telemetry';

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

	/**
	 * The address of a processor's derivative of an open object — the
	 * thumbnail, not the original.
	 *
	 * @throws {NotOpen} when the key matches no declared pattern.
	 * @throws {ProcessorNotOnThisServer} for another file server's processor.
	 */
	processedUrl<
		TPattern extends string,
		TSchema extends StandardSchemaV1 | undefined,
	>(
		processor: Processor<TPattern, TSchema, any, any>,
		params: ProcessorUrlParams<TPattern, TSchema>,
		key: string,
	): string;
}

/**
 * What addresses a derivative: the values the processor's schema accepts —
 * its input, since these go into a path — or, without one, the raw strings.
 */
export type ProcessorUrlParams<
	TPattern extends string,
	TSchema extends StandardSchemaV1 | undefined,
> = TSchema extends StandardSchemaV1
	? StandardSchemaV1.InferInput<TSchema>
	: PatternParams<TPattern>;

/** A processed URL was asked of a file server the processor is not on. */
export class ProcessorNotOnThisServer extends Error {
	constructor(
		readonly pattern: string,
		readonly server: string,
		readonly expected: string,
	) {
		super(
			`The processor at '${pattern}' belongs to '${server}', not '${expected}'. ` +
				`Ask its own file server for the URL: services.<its id>.processedUrl(…).`,
		);
		this.name = 'ProcessorNotOnThisServer';
	}
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
	/**
	 * Open paths whose objects never change once written — keyed by a content
	 * hash or a file id — so every client may keep them forever: the edge
	 * sends `Cache-Control: public, max-age=31536000, immutable`, over
	 * whatever the object was stored with.
	 *
	 * A subset of `open`, because a signed object is never served by the edge.
	 * Only say it of paths whose keys are written once: a client holding an
	 * immutable copy never asks again.
	 */
	immutable?: readonly string[];
	/** Keep previous versions of an object. */
	versioned?: boolean;
	/**
	 * Delete the objects under each prefix this many days after they were
	 * written — `{ 'previews/': { days: 7 } }`. A setting of the bucket this
	 * server vends, so it cannot be given with `origin`.
	 */
	expire?: ObjectExpiry;
	/**
	 * How long its processors' derivatives are kept in the bucket before it
	 * deletes them — 30 days unless said. They are remade on the next request,
	 * so this trades storage for the work of making one again.
	 */
	derived?: { readonly days: number };
	/**
	 * What its processor unit emits — the `Telemetry` construct, as a worker
	 * takes it: each request is a span, and the deploy hands the unit the
	 * `OTEL_*` keys its stage resolves.
	 */
	telemetry?: Telemetry;
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

/** An immutable pattern that no open pattern admits. */
export class ImmutableNotOpen extends Error {
	constructor(
		readonly id: string,
		readonly pattern: string,
		readonly open: readonly string[],
	) {
		super(
			`'${id}' says '${pattern}' is immutable, and no open path admits it` +
				(open.length ? ` (open: ${open.join(', ')})` : ' — it opens none') +
				'. Only an open path is served by the edge, so only one can be ' +
				'cached there: add it to `open`, or narrow it to one that is.',
		);
		this.name = 'ImmutableNotOpen';
	}
}

/**
 * A bucket setting given to a file server that fronts a bucket declared
 * elsewhere — where the bucket's own construct is the one that says it.
 */
export class BucketOptionOnOrigin extends Error {
	constructor(
		readonly server: string,
		readonly origin: string,
		readonly option: string,
	) {
		super(
			`'${server}' fronts '${origin}', which declares itself, so '${option}' ` +
				`belongs on the construct that declares '${origin}', not on the file server.`,
		);
		this.name = 'BucketOptionOnOrigin';
	}
}

/**
 * A bucket method called on a file server's client that was handed only its
 * public address — a frontend's plain edge.
 */
export class FileServerReadOnly extends Error {
	constructor(
		readonly id: string,
		readonly method: string,
		readonly key: string,
	) {
		super(
			`'${id}' was reached through its public address only, so it serves ` +
				`and cannot ${method}(): ${key} is not in this process's environment. ` +
				`A site or app whose server half writes or presigns depends on ` +
				`'${id}'.server instead — .dependsOn([${id.charAt(0).toLowerCase()}${id.slice(1)}.server]).`,
		);
		this.name = 'FileServerReadOnly';
	}
}

/** Names asked of any object, which a read-only client must not answer. */
const INTROSPECTED = new Set([
	'then',
	'toJSON',
	'constructor',
	'asymmetricMatch',
	'$$typeof',
	'nodeType',
	'inspect',
]);

/**
 * The bucket half of a client that has no bucket: every method throws
 * {@link FileServerReadOnly}, naming itself.
 *
 * A proxy rather than a list of stubs, so a method the storage client grows
 * later refuses the same way. What a runtime asks of any object is left
 * alone: `then`, because a client is resolved from a promise, and the names a
 * serialiser or a test's printer looks for.
 */
function readOnlyStorage(id: string, key: string): StorageClient {
	return new Proxy({} as StorageClient, {
		get(_target, property) {
			if (typeof property !== 'string' || INTROSPECTED.has(property)) return;
			return () => {
				throw new FileServerReadOnly(id, property, key);
			};
		},
	});
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
> implements Construct<TName, FileServerClient<TOpen>>, HasPublicFace
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, FileServerClient<TOpen>>;

	/** The id of the surface node, as opposed to the bucket's. */
	readonly surfaceId: string;

	private readonly open: readonly string[];
	private readonly immutable: readonly string[];

	/** The vended bucket's expiry, checked once: prefix → days. */
	private readonly expire: Record<string, number> | undefined;

	/** Days its processors' derivatives are kept, when it says. */
	private readonly derivedDays: number | undefined;

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the keys the
	 * target publishes and the keys the client reads cannot drift.
	 */
	private readonly keys: { origin: string; server: string };

	/**
	 * How a processor reaches the bucket: the bucket's own URL and nothing of
	 * the serving half, which a processor never needs. A field, not a getter:
	 * services are cached by object identity.
	 */
	private readonly origin: Service<string, StorageClient>;

	constructor(
		id: ConstructName<TName>,
		private readonly options: FileServerOptions<TOpen> = {},
	) {
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.open = options.open ?? [];
		this.immutable = options.immutable ?? [];
		for (const pattern of this.immutable) {
			if (!this.covers(pattern)) {
				throw new ImmutableNotOpen(canonical, pattern, this.open);
			}
		}

		// The surface takes the suffix and the bucket keeps the plain id, which
		// is what makes "serve a bucket I already have" an edit that adds a node
		// instead of renaming the one holding the data.
		const originId = options.origin?.id ?? canonical;
		if (options.origin && options.expire) {
			throw new BucketOptionOnOrigin(canonical, originId, 'expire');
		}
		this.expire = expiryDays(canonical, options.expire);
		this.derivedDays = options.derived
			? expiryDays(canonical, { [DERIVED_PREFIX]: options.derived })?.[
					DERIVED_PREFIX
				]
			: undefined;
		this.surfaceId = fileServerSurfaceId(canonical);

		this.keys = {
			origin: providedKeyFor(originId, 'objects', 'connectionString'),
			server: providedKeyFor(this.surfaceId, 'file-server', 'url'),
		};

		// A field, not a getter: consumers cache services by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			register: (registerOptions) => this.connect(registerOptions),
		};

		const originKey = this.keys.origin;
		this.origin = {
			serviceName: `${serviceKey(originId)}ProcessorOrigin`,
			register: ({ envParser }) => {
				const { url } = envParser
					.create((get) => ({ url: get(originKey).string() }))
					.parse();
				return createStorageClient(url);
			},
		};
	}

	/**
	 * A processor behind one path pattern of this server: a handler that makes
	 * a derivative of an open object on read.
	 *
	 * ```ts
	 * export const thumbnails = assets
	 *   .process('/i/:width/*')
	 *   .params(z.object({ width: z.enum(['64', '256', '1024']) }))
	 *   .native(['sharp'])
	 *   .handle(async ({ params, object }) => ({
	 *     body: await sharp(await object.bytes()).resize(Number(params.width)).webp().toBuffer(),
	 *     contentType: 'image/webp',
	 *     cache: 'immutable',
	 *   }));
	 * ```
	 *
	 * Open paths only: a key no `open` pattern admits is answered 404, as an
	 * unsigned read of it would be.
	 *
	 * @throws {ProcessorPatternInvalid} for a pattern the edge cannot route.
	 */
	process<TPattern extends `/${string}/*`>(
		pattern: TPattern,
		options: { logger?: Logger } = {},
	): ProcessorBuilder<TPattern> {
		return new ProcessorBuilder<TPattern>({
			parsed: parsePattern(pattern),
			surfaceId: this.surfaceId,
			bucketId: this.options.origin?.id ?? this.id,
			origin: this.origin,
			serves: (key) => this.serves(key),
			logger: (options.logger ?? DEFAULT_LOGGER) as Logger,
			native: [],
			services: [],
			constructs: [],
		});
	}

	/**
	 * The served surface: what a site's or a mobile app's plain
	 * `.dependsOn([uploads])` points at.
	 *
	 * Its address is public, so the frontend is built with it
	 * (`VITE_UPLOADS_URL`) — and it is all the frontend gets: no bucket, no
	 * key. A backend's plain edge is to the bucket, as it presigns and writes.
	 */
	get publicFace(): Declarable {
		const surface = this.declare().find(
			(declaration) => declaration.id === this.surfaceId,
		);

		return {
			id: this.surfaceId,
			declare: () => (surface ? [surface] : []),
		};
	}

	/**
	 * Everything: the bucket, its credentials, and the address it is served
	 * on.
	 *
	 * What a backend's plain edge already is. A frontend asks for it by name —
	 * `.dependsOn([uploads.server])` — when its server half uploads or
	 * presigns: a full-stack site's, never a bundle's. The bucket's connection
	 * is never inlined into a bundle either way; only the served address is.
	 */
	get server(): Declarable {
		const originId = this.options.origin?.id ?? this.id;
		const declarations = this.options.origin
			? this.options.origin.declare()
			: this.declare();

		return { id: originId, declare: () => declarations };
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
			...(this.immutable.length ? { immutable: this.immutable } : {}),
			...(this.derivedDays !== undefined
				? { derivedDays: this.derivedDays }
				: {}),
			...(this.options.telemetry
				? { telemetry: this.options.telemetry.id }
				: {}),
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
				...(this.expire ? { expire: this.expire } : {}),
			},
			surface,
		];
	}

	/**
	 * The bucket's client, with the serving half added.
	 *
	 * Both keys are read here, which is also how the environment reaches a
	 * handler: the sniffer records what this reads, so `.dependsOn([uploads])`
	 * carries the bucket's connection and the server's address without either
	 * being written down beside the handler.
	 *
	 * Without the connection — a site's or an app's plain edge, which is to
	 * the public face — the client serves and does nothing else: its bucket
	 * methods throw {@link FileServerReadOnly}.
	 */
	private async connect(
		options: ServiceRegisterOptions,
	): Promise<FileServerClient<TOpen>> {
		const { origin, server } = options.envParser
			.create((get) => ({
				origin: get(this.keys.origin).string().optional(),
				server: get(this.keys.server).string(),
			}))
			.parse();

		const storage = origin
			? createStorageClient(origin)
			: readOnlyStorage(this.id, this.keys.origin);
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
			processedUrl: (
				processor: Processor<string, any, any, any>,
				params: Record<string, string | number>,
				key: string,
			) => {
				if (processor.surfaceId !== this.surfaceId) {
					throw new ProcessorNotOnThisServer(
						processor.pattern,
						processor.surfaceId,
						this.surfaceId,
					);
				}
				if (!this.serves(key)) throw new NotOpen(key, this.open);
				return `${base}${fillPattern(processor.parsed, params, key)}`;
			},
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

	/**
	 * Whether every key a pattern admits is open: the pattern itself, each of
	 * its wildcards taken as a segment of its own, is a key an open pattern
	 * serves — `brand/logos/*` under `brand/**`, but not `**` under `brand/**`.
	 */
	private covers(pattern: string): boolean {
		return this.serves(pattern.replace(/\*\*/g, 'x/x').replace(/\*/g, 'x'));
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
