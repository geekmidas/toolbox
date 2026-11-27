import { BadRequestError } from '@geekmidas/errors';
import {
	convertStandardSchemaToJsonSchema,
	hasJsonSchema,
	toJsonSchema,
} from '@geekmidas/schema/conversion';
import type { ComponentCollector } from '@geekmidas/schema/openapi';
import type {
	StandardJSONSchemaV1,
	StandardSchemaV1,
} from '@standard-schema/spec';
import type { OpenAPIV3_1 } from 'openapi-types';

/**
 * Typed request headers and declared response headers.
 *
 * Header names are case-insensitive on the wire (RFC 9110 §5.1), and an
 * endpoint's request headers are validated as one object, whose keys have to
 * be fixed. So incoming names are lower-cased before validation — what HTTP/2
 * sends, and what Hono, `fetch`'s `Headers` and API Gateway v2 already hand
 * over — and a `.headers()` schema's keys are lower-case. Matching
 * case-insensitively instead would mean rewriting the keys of an arbitrary
 * schema, which a Standard Schema does not expose.
 */

/** What a header is: its value's schema, and what the reference says of it. */
export interface HeaderOptions<
	TSchema extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
> {
	/**
	 * The value's schema. A header has a string value on the wire, so a
	 * request header's schema is given a string. Without one, any string.
	 */
	schema?: TSchema;
	/** What the header carries, for the API reference. */
	description?: string;
	/**
	 * Whether it is always there. By default, a header with a schema is
	 * required unless the schema accepts `undefined` (`.optional()`), and one
	 * without a schema is optional.
	 */
	required?: boolean;
	/** Whether callers should stop relying on it. */
	deprecated?: boolean;
	/** An example value, for the API reference. */
	example?: unknown;
}

const HEADER_DEFINITION = Symbol.for('@geekmidas/constructs/header');

/**
 * A header declared once — `defineHeader('Idempotency-Key', …)` — and named
 * by every endpoint that reads or sends it. The document writes it once,
 * under `components.parameters` as a request header and `components.headers`
 * as a response header, and refers to it with `$ref` everywhere else.
 */
export interface HeaderDefinition<
	TName extends string = string,
	TInput = unknown,
	TOutput = unknown,
	TRequired extends boolean = boolean,
> {
	readonly [HEADER_DEFINITION]: true;
	/** The header's name, as the reference spells it — `Idempotency-Key`. */
	readonly name: TName;
	readonly schema?: StandardSchemaV1;
	readonly description?: string;
	readonly required: TRequired;
	readonly deprecated?: boolean;
	readonly example?: unknown;
	/** Types only: what is sent, and what the handler reads. */
	readonly '~types'?: { input: TInput; output: TOutput };
}

type SchemaOf<O> = O extends { schema: infer S extends StandardSchemaV1 }
	? S
	: undefined;

/** Whether a header declared with options `O` is always there. */
export type HeaderRequired<O> = O extends { required: infer R extends boolean }
	? R
	: SchemaOf<O> extends StandardSchemaV1
		? undefined extends StandardSchemaV1.InferInput<SchemaOf<O>>
			? false
			: true
		: false;

type HeaderInput<O> =
	SchemaOf<O> extends StandardSchemaV1
		? Exclude<StandardSchemaV1.InferInput<SchemaOf<O>>, undefined>
		: string;

type HeaderOutput<O> =
	SchemaOf<O> extends StandardSchemaV1
		? Exclude<StandardSchemaV1.InferOutput<SchemaOf<O>>, undefined>
		: string;

/**
 * Declare a header shared by many endpoints — on the request, in
 * `.headers({ 'idempotency-key': IdempotencyKey })`, or on the response, in
 * `.responseHeaders({ ETag })`. It is written once in the document and
 * referred to with `$ref` from each operation.
 *
 * @example
 * ```ts
 * export const IdempotencyKey = defineHeader('Idempotency-Key', {
 *   schema: z.string().min(1).max(255),
 *   description: 'Makes a retried request safe to repeat.',
 * });
 * export const ETag = defineHeader('ETag', {
 *   schema: z.string(),
 *   description: 'The version of the resource returned (RFC 9110 §8.8.3).',
 * });
 * ```
 */
export function defineHeader<
	const TName extends string,
	const TOptions extends HeaderOptions = {},
>(
	name: TName,
	options: TOptions = {} as TOptions,
): HeaderDefinition<
	TName,
	HeaderInput<TOptions>,
	HeaderOutput<TOptions>,
	HeaderRequired<TOptions>
> {
	return {
		[HEADER_DEFINITION]: true,
		name,
		...options,
		required: isRequired(options) as HeaderRequired<TOptions>,
	};
}

/** Whether `value` is a header made by {@link defineHeader}. */
export function isHeaderDefinition(value: unknown): value is HeaderDefinition {
	return Boolean(
		value &&
			typeof value === 'object' &&
			(value as Record<symbol, unknown>)[HEADER_DEFINITION] === true,
	);
}

/**
 * Request headers given field by field — each a schema, or a header made by
 * {@link defineHeader} — keyed by the header's name. The handler reads each
 * under its lower-cased name.
 */
export type RequestHeaderFields = Record<
	string,
	StandardSchemaV1 | HeaderDefinition<string, any, any, boolean>
>;

/** What `.headers()` takes: an object schema with lower-case keys, or fields. */
export type RequestHeadersInput = StandardSchemaV1 | RequestHeaderFields;

type FieldRequired<F> =
	F extends HeaderDefinition<string, any, any, infer R>
		? R
		: F extends StandardSchemaV1
			? undefined extends StandardSchemaV1.InferInput<F>
				? false
				: true
			: false;

type FieldInput<F> =
	F extends HeaderDefinition<string, infer I, any, boolean>
		? I
		: F extends StandardSchemaV1
			? Exclude<StandardSchemaV1.InferInput<F>, undefined>
			: never;

type FieldOutput<F> =
	F extends HeaderDefinition<string, any, infer O, boolean>
		? O
		: F extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<F>
			: never;

type Simplify<T> = { [K in keyof T]: T[K] };

type FieldsObject<
	T extends RequestHeaderFields,
	TSide extends 'input' | 'output',
> = Simplify<
	{
		-readonly [K in keyof T as FieldRequired<T[K]> extends true
			? Lowercase<K & string>
			: never]: TSide extends 'input' ? FieldInput<T[K]> : FieldOutput<T[K]>;
	} & {
		-readonly [K in keyof T as FieldRequired<T[K]> extends true
			? never
			: Lowercase<K & string>]?: TSide extends 'input'
			? FieldInput<T[K]>
			: FieldOutput<T[K]>;
	}
>;

/** The schema `.headers(fields)` validates with. */
export type RequestHeaderFieldsSchema<T extends RequestHeaderFields> =
	StandardSchemaV1<FieldsObject<T, 'input'>, FieldsObject<T, 'output'>> & {
		readonly fields: RequestHeaderField[];
	};

/** The schema an endpoint's request headers are validated with. */
export type RequestHeadersSchema<T extends RequestHeadersInput> =
	T extends StandardSchemaV1
		? T
		: T extends RequestHeaderFields
			? RequestHeaderFieldsSchema<T>
			: never;

/** One request header given as a field, with what was resolved of it. */
export interface RequestHeaderField {
	/** The key the handler reads it under — the name, lower-cased. */
	key: string;
	/** The name as it was written, for the document. */
	name: string;
	schema?: StandardSchemaV1;
	required: boolean;
	/** The shared header it is, if it was made by `defineHeader`. */
	definition?: HeaderDefinition;
}

/**
 * A `.headers()` schema key that is not lower-case. Incoming names are
 * lower-cased before validation, so such a key would never be matched.
 */
export class HeaderNameNotLowerCase extends Error {
	constructor(readonly key: string) {
		super(
			`'${key}' is not lower-case. Header names are case-insensitive, and an endpoint's request headers are lower-cased before its .headers() schema sees them — so name it '${key.toLowerCase()}' in the schema.`,
		);
		this.name = 'HeaderNameNotLowerCase';
	}
}

/**
 * A request whose headers the endpoint's `.headers()` refused — a required
 * one missing, or a value its schema does not accept. Answered with 400: the
 * request is malformed, where a body that fails its schema is 422.
 */
export class RequestHeadersInvalid extends BadRequestError {
	constructor(readonly issues: readonly StandardSchemaV1.Issue[]) {
		const names = [
			...new Set(
				issues.map((issue) => {
					const [key] = issue.path ?? [];
					return String(
						typeof key === 'object' && key !== null ? key.key : (key ?? ''),
					);
				}),
			),
		].filter(Boolean);
		super(
			`The request's headers are missing or invalid${names.length ? `: ${names.join(', ')}` : ''}. Send each header the endpoint documents, with a value its schema accepts.`,
			{ validationErrors: issues },
		);
		this.name = 'RequestHeadersInvalid';
	}
}

/**
 * The schema `.headers(input)` validates with: the schema itself, its keys
 * checked to be lower-case, or one built from fields.
 */
export function requestHeadersSchema<T extends RequestHeadersInput>(
	input: T,
): RequestHeadersSchema<T> {
	if (isStandardSchema(input)) {
		for (const key of Object.keys(jsonProperties(input))) {
			if (key !== key.toLowerCase()) throw new HeaderNameNotLowerCase(key);
		}
		return input as RequestHeadersSchema<T>;
	}
	return headerFieldsSchema(input) as RequestHeadersSchema<T>;
}

/**
 * Validate a request's headers against the endpoint's `.headers()` schema,
 * after lower-casing their names.
 *
 * @throws {RequestHeadersInvalid} When the schema refuses them
 */
export async function parseRequestHeaders(
	schema: StandardSchemaV1,
	raw: Record<string, string | string[] | undefined> | null | undefined,
): Promise<unknown> {
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(raw ?? {})) {
		if (value === undefined) continue;
		headers[name.toLowerCase()] = Array.isArray(value)
			? value.join(', ')
			: value;
	}

	const result = await schema['~standard'].validate(headers);
	if (result.issues) throw new RequestHeadersInvalid(result.issues);
	return result.value;
}

/**
 * Where an adaptor keeps a request's validated headers on an event whose
 * own `headers` are the raw ones.
 */
export const VALIDATED_HEADERS = Symbol('@geekmidas/constructs/headers');

/**
 * The request headers' `in: header` parameters: a `$ref` to
 * `components.parameters` for a shared header, the parameter itself for any
 * other.
 */
export async function documentRequestHeaders(
	schema: StandardSchemaV1 | undefined,
	collector?: ComponentCollector,
): Promise<(OpenAPIV3_1.ParameterObject | OpenAPIV3_1.ReferenceObject)[]> {
	if (!schema) return [];

	const fields = (schema as Partial<RequestHeaderFieldsSchema<{}>>).fields;
	if (!fields) {
		const json = await convertStandardSchemaToJsonSchema(
			sentSide(schema),
			collector,
		);
		const required = new Set<string>(json?.required ?? []);
		return Object.entries(
			(json?.properties ?? {}) as Record<string, Record<string, unknown>>,
		).map(([name, property]): OpenAPIV3_1.ParameterObject => {
			const { description, ...rest } = property;
			return {
				name,
				in: 'header',
				required: required.has(name),
				...(typeof description === 'string' ? { description } : {}),
				// openapi-types types a 3.1 parameter's schema as a 3.0 one.
				schema: rest as any,
			};
		});
	}

	const parameters: (
		| OpenAPIV3_1.ParameterObject
		| OpenAPIV3_1.ReferenceObject
	)[] = [];
	for (const field of fields) {
		const parameter: OpenAPIV3_1.ParameterObject = {
			name: field.definition?.name ?? field.name,
			in: 'header',
			required: field.required,
			...(await headerDetails(
				field.definition ?? { schema: field.schema },
				collector,
				'input',
			)),
		};
		if (field.definition && collector?.addParameter) {
			collector.addParameter(field.definition.name, parameter);
			parameters.push({
				$ref: `#/components/parameters/${field.definition.name}`,
			});
		} else {
			parameters.push(parameter);
		}
	}
	return parameters;
}

/** The headers a successful response carries — `.responseHeaders()`. */
export type ResponseHeaders = Record<string, HeaderOptions | HeaderDefinition>;

/**
 * The response's `headers`: a `$ref` to `components.headers` for a shared
 * header, the header itself for any other. Nothing when none were declared.
 */
export async function documentResponseHeaders(
	headers: ResponseHeaders | undefined,
	collector?: ComponentCollector,
): Promise<
	| Record<string, OpenAPIV3_1.HeaderObject | OpenAPIV3_1.ReferenceObject>
	| undefined
> {
	const entries = Object.entries(headers ?? {});
	if (entries.length === 0) return undefined;

	const documented: Record<
		string,
		OpenAPIV3_1.HeaderObject | OpenAPIV3_1.ReferenceObject
	> = {};
	for (const [name, header] of entries) {
		const object: OpenAPIV3_1.HeaderObject = {
			required: isHeaderDefinition(header)
				? header.required
				: isRequired(header),
			...(await headerDetails(header, collector, 'output')),
		};
		if (isHeaderDefinition(header) && collector?.addHeader) {
			collector.addHeader(header.name, object);
			documented[name] = { $ref: `#/components/headers/${header.name}` };
		} else {
			documented[name] = object;
		}
	}
	return documented;
}

/** What a parameter and a header object share: description, schema, … */
async function headerDetails(
	header: HeaderOptions | HeaderDefinition,
	collector: ComponentCollector | undefined,
	side: 'input' | 'output',
) {
	const schema = header.schema
		? await convertStandardSchemaToJsonSchema(
				side === 'input' ? sentSide(header.schema) : header.schema,
				collector,
			)
		: { type: 'string' };
	return {
		...(header.description ? { description: header.description } : {}),
		...(header.deprecated ? { deprecated: true } : {}),
		schema,
		...(header.example !== undefined ? { example: header.example } : {}),
	};
}

/**
 * `schema`, as the side that is sent: a request header is documented by what
 * the client puts on the wire — a field with a default is one it may leave
 * out — where the conversion reads the parsed side.
 */
export function sentSide(schema: StandardSchemaV1): StandardSchemaV1 {
	if (!hasJsonSchema(schema)) return schema;
	const standard = schema['~standard'];
	return {
		'~standard': {
			...standard,
			jsonSchema: {
				input: standard.jsonSchema.input,
				output: standard.jsonSchema.input,
			},
		},
	} as StandardSchemaV1;
}

function isRequired(header: HeaderOptions): boolean {
	if (header.required !== undefined) return header.required;
	return header.schema ? !acceptsUndefined(header.schema) : false;
}

/**
 * Whether a schema accepts `undefined` — asked of the schema, synchronously.
 * A schema that only validates asynchronously is taken not to.
 */
function acceptsUndefined(schema: StandardSchemaV1): boolean {
	const result = schema['~standard'].validate(undefined);
	if (result instanceof Promise) {
		result.catch(() => {});
		return false;
	}
	return !result.issues;
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
	return Boolean(
		value &&
			typeof value === 'object' &&
			'~standard' in (value as Record<string, unknown>),
	);
}

/** A schema's JSON Schema properties, where it says what they are. */
function jsonProperties(schema: StandardSchemaV1): Record<string, unknown> {
	if (!hasJsonSchema(schema)) return {};
	try {
		return toJsonSchema(schema)?.properties ?? {};
	} catch {
		return {};
	}
}

/**
 * One Standard Schema for the fields `.headers()` was given: each validated
 * by its own schema, under its lower-cased name — with a JSON Schema built
 * from theirs, so the document and the generated client read it as they read
 * any object schema.
 */
function headerFieldsSchema<T extends RequestHeaderFields>(
	input: T,
): RequestHeaderFieldsSchema<T> {
	const fields: RequestHeaderField[] = Object.entries(input).map(
		([name, value]) => {
			const definition = isHeaderDefinition(value) ? value : undefined;
			const schema = definition
				? definition.schema
				: (value as StandardSchemaV1);
			return {
				key: name.toLowerCase(),
				name,
				...(schema ? { schema } : {}),
				required: definition ? definition.required : !acceptsUndefined(schema!),
				...(definition ? { definition } : {}),
			};
		},
	);

	const jsonSchema =
		(side: 'input' | 'output') =>
		(options: StandardJSONSchemaV1.Options): Record<string, unknown> => {
			const properties: Record<string, unknown> = {};
			for (const field of fields) {
				const property: Record<string, unknown> =
					field.schema && hasJsonSchema(field.schema)
						? {
								...field.schema['~standard'].jsonSchema[side](options),
							}
						: { type: 'string' };
				delete property.$schema;
				const description = field.definition?.description;
				if (description && !property.description) {
					property.description = description;
				}
				properties[field.key] = property;
			}
			const required = fields
				.filter((field) => field.required)
				.map((field) => field.key);
			return {
				type: 'object',
				properties,
				...(required.length ? { required } : {}),
			};
		};

	const standard: StandardSchemaV1.Props & StandardJSONSchemaV1.Props = {
		version: 1,
		vendor: '@geekmidas/constructs',
		async validate(value) {
			const headers = (value ?? {}) as Record<string, unknown>;
			const output: Record<string, unknown> = {};
			const issues: StandardSchemaV1.Issue[] = [];

			for (const field of fields) {
				const raw = headers[field.key];
				if (raw === undefined && !field.required) continue;
				if (!field.schema) {
					if (typeof raw === 'string') output[field.key] = raw;
					else issues.push({ message: 'Required', path: [field.key] });
					continue;
				}
				const result = await field.schema['~standard'].validate(raw);
				if (result.issues) {
					for (const issue of result.issues) {
						issues.push({
							...issue,
							path: [field.key, ...(issue.path ?? [])],
						});
					}
				} else if (result.value !== undefined) {
					output[field.key] = result.value;
				}
			}

			return issues.length ? { issues } : { value: output };
		},
		jsonSchema: { input: jsonSchema('input'), output: jsonSchema('output') },
	};

	return { '~standard': standard, fields } as RequestHeaderFieldsSchema<T>;
}
