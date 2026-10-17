/**
 * Direct uploads: an endpoint that hands the browser a signed form, so the
 * file goes straight to the bucket and never through the server.
 *
 * The endpoint decides *where* — the key, from the session and the body — and
 * the form's policy decides *what*: the storage itself refuses a file larger
 * than `maxSize`, or of a type `accept` does not allow. Nothing the client
 * sends after this request is trusted to the server that issued it. That the
 * upload finished arrives as the bucket's `object.created` event.
 */

import { HttpError } from '@geekmidas/errors';
import type { StorageClient, UploadPost } from '@geekmidas/storage';
import type {
	StandardJSONSchemaV1,
	StandardSchemaV1,
} from '@standard-schema/spec';

export type { UploadPost };

/** What an endpoint's `.upload(bucket, …)` allows. */
export interface UploadOptions<TContext> {
	/** Where the object lands, from what the handler would be given. */
	key: (ctx: TContext) => string | Promise<string>;
	/** The largest file the storage accepts, in bytes. */
	maxSize: number;
	/**
	 * The types the file may be: `image/png`, or `image/*` for any image.
	 * Absent, any type is accepted.
	 *
	 * A storage policy fixes one type, or one prefix, and cannot say "either of
	 * these". So with more than one, `contentType` says which this upload is
	 * — and it must be one of them.
	 */
	accept?: readonly string[];
	/** The type this upload is sent as — required when `accept` lists several. */
	contentType?: (ctx: TContext) => string | Promise<string>;
	/** How long the form is valid, in seconds. Defaults to 300. */
	expiresIn?: number;
}

/** The longest a signature may be valid for: S3's limit, seven days. */
const MAX_EXPIRES_IN = 7 * 24 * 60 * 60;

/** A media type, or a whole top-level type: `image/png`, `image/*`. */
const MEDIA_TYPE =
	/^[a-z0-9][a-z0-9!#$&^_.+-]*\/(\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/i;

/** An upload's `maxSize` that is not a positive whole number of bytes. */
export class UploadMaxSizeInvalid extends Error {
	constructor(readonly maxSize: number) {
		super(
			`An upload's maxSize is ${maxSize}, and it has to be a positive whole ` +
				`number of bytes — 5 * 1024 * 1024 for 5 MiB.`,
		);
		this.name = 'UploadMaxSizeInvalid';
	}
}

/** An upload's `expiresIn` outside what a signature can be valid for. */
export class UploadExpiryInvalid extends Error {
	constructor(readonly expiresIn: number) {
		super(
			`An upload's expiresIn is ${expiresIn}, and it has to be a whole number ` +
				`of seconds from 1 to ${MAX_EXPIRES_IN} (seven days, the longest S3 ` +
				`signs for). The default, 300, is usually right.`,
		);
		this.name = 'UploadExpiryInvalid';
	}
}

/** An entry in `accept` that is not a media type. */
export class UploadAcceptInvalid extends Error {
	constructor(readonly entry: string) {
		super(
			`'${entry}' in an upload's accept is not a media type. Name one ` +
				`('image/png') or a whole type ('image/*').`,
		);
		this.name = 'UploadAcceptInvalid';
	}
}

/** Several accepted types, and nothing saying which one an upload is. */
export class UploadContentTypeUnresolved extends Error {
	constructor(readonly accept: readonly string[]) {
		super(
			`An upload accepts ${accept.join(', ')}, and a signed form can fix only ` +
				`one type. Add contentType: ({ body }) => body.contentType, with the ` +
				`body naming which of them this file is.`,
		);
		this.name = 'UploadContentTypeUnresolved';
	}
}

/** A request for an upload of a type the endpoint does not accept. */
export class UploadContentTypeRefused extends HttpError {
	constructor(
		readonly contentType: string,
		readonly accept: readonly string[],
	) {
		super(
			415,
			`'${contentType}' is not accepted here. Upload one of: ${accept.join(', ')}.`,
			{ details: { contentType, accept } },
		);
		this.name = 'UploadContentTypeRefused';
	}
}

/**
 * Check an upload's options when the endpoint is built, so a mistake fails at
 * startup rather than on the first request.
 */
export function checkUploadOptions(options: UploadOptions<never>): void {
	if (!Number.isInteger(options.maxSize) || options.maxSize <= 0) {
		throw new UploadMaxSizeInvalid(options.maxSize);
	}
	const { expiresIn } = options;
	if (
		expiresIn !== undefined &&
		(!Number.isInteger(expiresIn) ||
			expiresIn < 1 ||
			expiresIn > MAX_EXPIRES_IN)
	) {
		throw new UploadExpiryInvalid(expiresIn);
	}
	for (const entry of options.accept ?? []) {
		if (!MEDIA_TYPE.test(entry)) throw new UploadAcceptInvalid(entry);
	}
	if ((options.accept?.length ?? 0) > 1 && !options.contentType) {
		throw new UploadContentTypeUnresolved(options.accept!);
	}
}

/** Whether `type` is one `accept` allows — exactly, or under a `type/*`. */
function accepts(accept: readonly string[], type: string): boolean {
	const wanted = type.toLowerCase();
	return accept.some((entry) => {
		const allowed = entry.toLowerCase();
		return allowed.endsWith('/*')
			? wanted.startsWith(allowed.slice(0, -1))
			: allowed === wanted;
	});
}

/**
 * The signed form for one request: the key and type resolved from the
 * handler's context, and the policy the storage enforces.
 *
 * @throws {UploadContentTypeRefused} when the resolved type is not accepted
 */
export async function issueUpload<TContext>(
	storage: StorageClient,
	ctx: TContext,
	options: UploadOptions<TContext>,
): Promise<UploadPost> {
	const key = await options.key(ctx);
	const accept = options.accept ?? [];
	const resolved = options.contentType
		? await options.contentType(ctx)
		: undefined;

	let contentType: string | { startsWith: string } | undefined;
	if (resolved !== undefined) {
		if (accept.length > 0 && !accepts(accept, resolved)) {
			throw new UploadContentTypeRefused(resolved, accept);
		}
		contentType = resolved;
	} else if (accept.length === 1) {
		const only = accept[0]!;
		contentType = only.endsWith('/*')
			? { startsWith: only.slice(0, -1) }
			: only;
	}

	return storage.getUploadPost({
		key,
		maxSize: options.maxSize,
		...(contentType ? { contentType } : {}),
		...(options.expiresIn !== undefined
			? { expiresIn: options.expiresIn }
			: {}),
	});
}

/** The JSON Schema of an {@link UploadPost}, for the endpoint's OpenAPI. */
const UPLOAD_POST_JSON_SCHEMA = {
	type: 'object',
	properties: {
		url: { type: 'string', format: 'uri' },
		fields: { type: 'object', additionalProperties: { type: 'string' } },
		key: { type: 'string' },
		expiresAt: { type: 'string', format: 'date-time' },
	},
	required: ['url', 'fields', 'key', 'expiresAt'],
	additionalProperties: false,
} as const;

/** Whether `value` is an {@link UploadPost}. */
function isUploadPost(value: unknown): value is UploadPost {
	if (!value || typeof value !== 'object') return false;
	const { url, fields, key, expiresAt } = value as Record<string, unknown>;
	return (
		typeof url === 'string' &&
		typeof key === 'string' &&
		typeof expiresAt === 'string' &&
		!!fields &&
		typeof fields === 'object' &&
		Object.values(fields).every((field) => typeof field === 'string')
	);
}

/**
 * An upload endpoint's output, when it declares none of its own: the signed
 * form, as the handler is given it.
 *
 * Written by hand rather than with a schema library, so the endpoint runtime
 * imports none — the Standard Schema and Standard JSON Schema interfaces are
 * the whole of what validation and OpenAPI need.
 */
export const UPLOAD_POST_SCHEMA: StandardSchemaV1<UploadPost> &
	StandardJSONSchemaV1<UploadPost> = {
	'~standard': {
		version: 1,
		vendor: 'geekmidas',
		validate: (value) =>
			isUploadPost(value)
				? { value }
				: { issues: [{ message: 'Expected an upload form' }] },
		jsonSchema: {
			input: () => structuredClone(UPLOAD_POST_JSON_SCHEMA),
			output: () => structuredClone(UPLOAD_POST_JSON_SCHEMA),
		},
	},
};
