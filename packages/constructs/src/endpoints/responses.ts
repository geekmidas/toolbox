import { convertSchemaWithComponents } from '@geekmidas/schema/conversion';
import type { ComponentCollector } from '@geekmidas/schema/openapi';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { OpenAPIV3_1 } from 'openapi-types';
import { Function } from '../functions';

/**
 * The responses an endpoint declares beside its default one —
 * `.response(status, content, { description })`.
 *
 * The default response is still `.output()`, `.status()` and
 * `.responseType()`. A declared response is another status the handler may
 * answer with (`response.status(200).send(original)`), or the default status
 * answered in more than one content type: each is documented, the client types
 * it, and the body is checked against the declared schema rather than
 * `.output()`.
 */

/** The bytes a binary body may be given as — whatever a `Response` accepts. */
export type BinaryBody =
	| Uint8Array
	| ArrayBuffer
	| Blob
	| ReadableStream<Uint8Array>
	| string;

const BINARY = Symbol.for('@geekmidas/constructs/binary');

/** A body that is bytes, not JSON — see {@link binary}. */
export interface BinarySchema extends StandardSchemaV1<BinaryBody, BinaryBody> {
	readonly [BINARY]: true;
}

/**
 * An opaque body — a PDF, an image, an archive. Documented as
 * `{ type: 'string', format: 'binary' }`, emitted as-is, and typed as the
 * bytes a `Response` accepts. The generated client types it as a `Blob`.
 *
 * @example
 * ```typescript
 * .response(200, {
 *   'application/json': Report,
 *   'application/pdf': binary(),
 * })
 * ```
 */
export function binary(): BinarySchema {
	return {
		[BINARY]: true,
		'~standard': {
			version: 1,
			vendor: 'geekmidas',
			validate(value) {
				if (isBinaryBody(value)) return { value };
				return {
					issues: [
						{
							message:
								'A binary response is bytes: return a Uint8Array, ArrayBuffer, Blob, ReadableStream or string.',
						},
					],
				};
			},
		},
	};
}

/** Whether `schema` is {@link binary}'s. */
export function isBinarySchema(schema: unknown): schema is BinarySchema {
	return (
		typeof schema === 'object' &&
		schema !== null &&
		(schema as Record<symbol, unknown>)[BINARY] === true
	);
}

function isBinaryBody(value: unknown): value is BinaryBody {
	return (
		typeof value === 'string' ||
		value instanceof Uint8Array ||
		value instanceof ArrayBuffer ||
		(typeof Blob !== 'undefined' && value instanceof Blob) ||
		(typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
	);
}

/**
 * What a response's body is: one schema, which is JSON, or a schema per
 * content type — `{ 'application/json': Report, 'text/csv': z.string() }`.
 */
export type ResponseContent =
	| StandardSchemaV1
	| Readonly<Record<string, StandardSchemaV1>>;

/** A declared response, as the endpoint keeps it. */
export interface DeclaredResponse {
	status: number;
	description?: string;
	/** Content type → schema. Empty for a response with no body (a 204). */
	content: Record<string, StandardSchemaV1>;
}

/** Options for `.response()`. */
export interface ResponseOptions {
	/** What this response means — the document's `description`. */
	description?: string;
}

/**
 * A response the handler answered in a content type its `.response()` does
 * not list — set with `response.header('content-type', …)`.
 */
export class UndeclaredResponseContentType extends Error {
	constructor(
		readonly status: number,
		readonly contentType: string,
		readonly declared: readonly string[],
	) {
		super(
			`The handler answered ${status} as '${contentType}', but .response(${status}, …) lists only ${declared.map((t) => `'${t}'`).join(', ')}. Add '${contentType}' to that response's content map, or answer with one it lists.`,
		);
		this.name = 'UndeclaredResponseContentType';
	}
}

/** Normalizes `.response()`'s arguments into the form an endpoint keeps. */
export function declareResponse(
	status: number,
	content: ResponseContent | undefined,
	options: ResponseOptions = {},
): DeclaredResponse {
	const map: Record<string, StandardSchemaV1> =
		content === undefined
			? {}
			: isStandardSchema(content)
				? { 'application/json': content }
				: { ...content };
	return {
		status,
		...(options.description && { description: options.description }),
		content: map,
	};
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
	return (
		(typeof value === 'object' || typeof value === 'function') &&
		value !== null &&
		'~standard' in value
	);
}

/** The declared response for `status`, when there is one. */
export function findDeclaredResponse(
	responses: readonly DeclaredResponse[],
	status: number,
): DeclaredResponse | undefined {
	// The last declaration of a status wins, as a builder call does.
	for (let i = responses.length - 1; i >= 0; i--) {
		if (responses[i]!.status === status) return responses[i];
	}
	return undefined;
}

function headerContentType(
	headers: Record<string, string> | undefined,
): string | undefined {
	if (!headers) return undefined;
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === 'content-type') {
			return value.split(';')[0]!.trim().toLowerCase();
		}
	}
	return undefined;
}

/**
 * The content type a declared response is answered in: the one the handler
 * set with `response.header('content-type', …)`, or the first it lists.
 *
 * @throws {UndeclaredResponseContentType} When the handler set one the
 *   response does not list.
 */
export function declaredContentType(
	response: DeclaredResponse,
	headers: Record<string, string> | undefined,
): string {
	const types = Object.keys(response.content);
	const chosen = headerContentType(headers);
	if (chosen === undefined) return types[0] ?? 'application/json';
	const match = types.find((t) => t.toLowerCase() === chosen);
	if (match) return match;
	if (types.length === 0) return chosen;
	throw new UndeclaredResponseContentType(response.status, chosen, types);
}

/**
 * Checks a body against the declared response it answers — the schema for the
 * content type it is answered in. A response with no body passes nothing on.
 */
export async function parseDeclaredResponse(
	response: DeclaredResponse,
	data: unknown,
	headers: Record<string, string> | undefined,
): Promise<unknown> {
	const schema = response.content[declaredContentType(response, headers)];
	if (!schema) return undefined;
	return Function.parseSchema(schema, data);
}

/**
 * Adds each declared response to an operation's `responses`. One that shares
 * the default response's status replaces it.
 */
export async function documentDeclaredResponses(
	operation: OpenAPIV3_1.OperationObject,
	responses: readonly DeclaredResponse[],
	componentCollector?: ComponentCollector,
): Promise<void> {
	for (const response of responses) {
		const document: OpenAPIV3_1.ResponseObject = {
			description: response.description ?? 'Successful response',
		};
		const content: Record<string, OpenAPIV3_1.MediaTypeObject> = {};
		for (const [type, schema] of Object.entries(response.content)) {
			const converted = isBinarySchema(schema)
				? { type: 'string', format: 'binary' }
				: await convertSchemaWithComponents(schema, componentCollector);
			content[type] = converted ? { schema: converted } : {};
		}
		if (Object.keys(content).length > 0) document.content = content;
		operation.responses = {
			...operation.responses,
			[String(response.status)]: document,
		};
	}
}

/**
 * A non-JSON body as API Gateway carries it: text as-is, bytes base64-encoded
 * with `isBase64Encoded`.
 */
export async function toLambdaBody(
	output: unknown,
): Promise<{ body: string; isBase64Encoded?: true }> {
	if (typeof output === 'string') return { body: output };
	if (
		output instanceof Uint8Array ||
		output instanceof ArrayBuffer ||
		(typeof Blob !== 'undefined' && output instanceof Blob) ||
		(typeof ReadableStream !== 'undefined' && output instanceof ReadableStream)
	) {
		const bytes = Buffer.from(await new Response(output as Blob).arrayBuffer());
		return { body: bytes.toString('base64'), isBase64Encoded: true };
	}
	return { body: String(output) };
}

// ---------------------------------------------------------------------------
// Types: what `.response()` makes of the endpoint's output schema
// ---------------------------------------------------------------------------

/** `.response()`'s content as a content map. */
export type ContentMapOf<C> = C extends StandardSchemaV1
	? { 'application/json': C }
	: C extends undefined
		? {}
		: C;

type SchemaInput<S> = S extends StandardSchemaV1
	? StandardSchemaV1.InferInput<S>
	: undefined;
type SchemaOutput<S> = S extends StandardSchemaV1
	? StandardSchemaV1.InferOutput<S>
	: never;

type ContentInput<M> = {
	[K in keyof M]: SchemaInput<M[K]>;
}[keyof M];
type ContentOutput<M> = {
	[K in keyof M]: SchemaOutput<M[K]>;
}[keyof M];

/**
 * Carried, as types only, by the output schema of an endpoint that declared
 * responses: `~default` is `.output()`'s schema and `~responses` maps each
 * declared status to its content map. Nothing reads them at runtime.
 */
export interface DeclaredResponses<TDefault, TResponses> {
	readonly '~default': TDefault;
	readonly '~responses': TResponses;
}

/** `.output()`'s schema, whether or not responses were declared. */
export type DefaultSchemaOf<S> =
	S extends DeclaredResponses<infer D, any> ? D : S;

/** Status → content map for each declared response; `{}` for none. */
export type DeclaredResponsesOf<S> =
	S extends DeclaredResponses<any, infer R> ? R : {};

/**
 * The output schema once `.response(status, content)` is declared: the handler
 * may return the default output or any declared body, and the declared
 * responses are kept for the client to type.
 */
export type WithResponse<
	OutSchema,
	TStatus extends number,
	TContent,
> = StandardSchemaV1<
	| SchemaInput<DefaultSchemaOf<OutSchema>>
	| AllInputs<DeclaredResponsesOf<OutSchema>>
	| ContentInput<ContentMapOf<TContent>>,
	| SchemaOutput<DefaultSchemaOf<OutSchema>>
	| AllOutputs<DeclaredResponsesOf<OutSchema>>
	| ContentOutput<ContentMapOf<TContent>>
> &
	DeclaredResponses<
		DefaultSchemaOf<OutSchema>,
		Omit<DeclaredResponsesOf<OutSchema>, TStatus> & {
			[K in TStatus]: ContentMapOf<TContent>;
		}
	>;

type AllInputs<R> = { [S in keyof R]: ContentInput<R[S]> }[keyof R];
type AllOutputs<R> = { [S in keyof R]: ContentOutput<R[S]> }[keyof R];
