import { HttpError } from '@geekmidas/errors';

/**
 * The media types an endpoint's `.body()` schema can be handed — as written
 * in the 415 a request in any other type is answered with.
 */
export const SUPPORTED_BODY_TYPES = [
	'application/json',
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/*',
] as const;

/**
 * A request whose body is in a media type no endpoint reads — XML, a bare
 * octet stream. Answered with a 415, before the body schema runs.
 */
export class UnsupportedRequestContentType extends HttpError {
	constructor(readonly contentType: string) {
		super(
			415,
			`A body sent as '${contentType}' can't be read. Send it as ${SUPPORTED_BODY_TYPES.join(', ')}.`,
			{
				statusMessage: 'Unsupported Media Type',
				details: { contentType, supported: [...SUPPORTED_BODY_TYPES] },
			},
		);
		this.name = 'UnsupportedRequestContentType';
	}
}

/**
 * A body that says it is JSON and is not. Answered with a 400 — the request
 * is broken, not merely invalid against the schema.
 */
export class MalformedRequestBody extends HttpError {
	constructor(
		readonly contentType: string,
		cause?: Error,
	) {
		super(
			400,
			`The body says it is '${contentType}' but can't be parsed as that. Send a well-formed body, with the Content-Type it is written in.`,
			{ cause },
		);
		this.name = 'MalformedRequestBody';
	}
}

/**
 * What a body is read from: a `Request`, or Hono's request — which caches
 * what it read, so a later reader is not handed a spent stream.
 */
export interface RequestBodySource {
	json(): Promise<unknown>;
	text(): Promise<string>;
	formData(): Promise<FormData>;
}

export interface ReadRequestBodyOptions {
	/**
	 * A body with no Content-Type: read as JSON (`'json'`, what API Gateway
	 * has always done), or not read at all and handed to the schema as `{}`
	 * (`'empty'`, what a Hono server has always done).
	 */
	untyped: 'json' | 'empty';
}

/**
 * A request body, read by its Content-Type into what an endpoint's `.body()`
 * schema validates — the one place every adaptor reads a body:
 *
 * - `application/json` (and `application/*+json`) — the parsed JSON.
 * - `application/x-www-form-urlencoded` and `multipart/form-data` — a plain
 *   object of fields, as an HTML form posts them. A repeated field, or one
 *   named `field[]`, is an array; a file part is a `File`.
 * - `text/*` — the text.
 *
 * Anything else is an {@link UnsupportedRequestContentType}.
 */
export async function readRequestBody(
	source: RequestBodySource,
	contentType: string | null | undefined,
	options: ReadRequestBodyOptions,
): Promise<unknown> {
	const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();

	if (!mediaType) {
		if (options.untyped === 'empty') return {};
		return readJson(source, 'application/json');
	}

	if (isJson(mediaType)) return readJson(source, mediaType);

	if (
		mediaType === 'application/x-www-form-urlencoded' ||
		mediaType === 'multipart/form-data'
	) {
		return formFields(await readForm(source, mediaType));
	}

	if (mediaType.startsWith('text/')) return source.text();

	throw new UnsupportedRequestContentType(mediaType);
}

function isJson(mediaType: string): boolean {
	return (
		mediaType === 'application/json' ||
		(mediaType.startsWith('application/') && mediaType.endsWith('+json'))
	);
}

async function readJson(
	source: RequestBodySource,
	mediaType: string,
): Promise<unknown> {
	try {
		return await source.json();
	} catch (error) {
		throw new MalformedRequestBody(mediaType, error as Error);
	}
}

async function readForm(
	source: RequestBodySource,
	mediaType: string,
): Promise<FormData> {
	try {
		return await source.formData();
	} catch (error) {
		throw new MalformedRequestBody(mediaType, error as Error);
	}
}

/** A form field's value: its text, or a `File` for a file part. */
type FormValue = NonNullable<ReturnType<FormData['get']>>;

/**
 * A form's fields as an object, the way Hono's `parseBody({ all: true })`
 * reads them. Without a prototype, so a field named `__proto__` is a field.
 */
function formFields(form: FormData): Record<string, FormValue | FormValue[]> {
	const fields: Record<string, FormValue | FormValue[]> = Object.create(null);

	for (const [key, value] of form.entries()) {
		const existing = fields[key];
		if (existing === undefined) {
			fields[key] = key.endsWith('[]') ? [value] : value;
		} else if (Array.isArray(existing)) {
			existing.push(value);
		} else {
			fields[key] = [existing, value];
		}
	}

	return fields;
}
