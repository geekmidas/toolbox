import { hasJsonSchema } from '@geekmidas/schema/conversion';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * The generated client's request and response header types — keyed by the
 * header's name, quoted, since a header name is rarely an identifier.
 */

interface JsonSchemaLike {
	properties?: Record<string, unknown>;
	required?: string[];
	[key: string]: unknown;
}

/** Converts one property's JSON Schema to a TypeScript type. */
type ToTs = (schema: any) => string;

/**
 * The interface for an endpoint's `.headers()`, as the client sends them —
 * the schema's input side, so a header with a default may be left out.
 */
export function requestHeadersInterface(
	schema: StandardSchemaV1,
	name: string,
	toTs: ToTs,
): string {
	if (!hasJsonSchema(schema)) {
		return `export type ${name} = Record<string, string>;`;
	}
	const json = schema['~standard'].jsonSchema.input({
		target: 'draft-2020-12',
	}) as JsonSchemaLike;
	const required = new Set(json.required ?? []);
	const props = Object.entries(json.properties ?? {}).map(
		([key, property]) =>
			`  ${quote(key)}${required.has(key) ? '' : '?'}: ${toTs(property)};`,
	);
	return `export interface ${name} {\n${props.join('\n')}\n}`;
}

/** A documented response header: whether it is always sent, and its schema. */
export interface ResponseHeaderInfo {
	required?: boolean;
	schema?: unknown;
}

/**
 * The `headers` of a response in the generated `paths`, as openapi-typescript
 * writes them: each declared header, and any other as `unknown`.
 */
export function responseHeadersType(
	headers: Record<string, ResponseHeaderInfo>,
	toTs: ToTs,
): string {
	const props = Object.entries(headers).map(
		([key, header]) =>
			`${quote(key)}${header.required ? '' : '?'}: ${header.schema ? toTs(header.schema) : 'string'}`,
	);
	return `{ ${[...props, '[name: string]: unknown'].join('; ')} }`;
}

function quote(key: string): string {
	return `'${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
