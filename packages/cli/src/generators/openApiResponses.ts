import type { DeclaredResponse } from '@geekmidas/constructs/endpoints';
import { isBinarySchema } from '@geekmidas/constructs/endpoints';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * The `responses` of a generated operation: the default response under the
 * status it answers, and each response `.response()` declared, with every
 * content type it lists.
 */

/** What the generator needs to know about an endpoint's responses. */
export interface ResponsesInfo {
	/** The status `.output()` answers with — `.status()`, 200 by default. */
	status: number;
	/** `.output()`'s content type. */
	responseType: string;
	/** The responses `.response()` declared. */
	responses: DeclaredResponse[];
}

/** A declared response's schema, and the name its interface gets by default. */
export interface DeclaredResponseSchema {
	status: number;
	contentType: string;
	schema: StandardSchemaV1;
	defaultName: string;
}

/**
 * The schemas the declared responses need interfaces for. A binary body has
 * none: it is typed as a `Blob`.
 */
export function declaredResponseSchemas(
	info: ResponsesInfo,
	baseName: string,
): DeclaredResponseSchema[] {
	const schemas: DeclaredResponseSchema[] = [];
	for (const response of info.responses) {
		for (const [contentType, schema] of Object.entries(response.content)) {
			if (isBinarySchema(schema)) continue;
			schemas.push({
				status: response.status,
				contentType,
				schema,
				defaultName: `${baseName}Response${response.status}${contentSuffix(contentType)}`,
			});
		}
	}
	return schemas;
}

/** `''` for JSON, otherwise the media type in PascalCase — `text/csv` → `TextCsv`. */
function contentSuffix(contentType: string): string {
	if (contentType === 'application/json') return '';
	return contentType
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');
}

/**
 * The `responses: { … }` member of a generated operation.
 *
 * @param outputName - the default response's type (`unknown` without `.output()`)
 * @param nameOf - the interface name of a declared response's schema
 */
export async function printResponses(
	info: ResponsesInfo,
	outputName: string,
	declared: DeclaredResponseSchema[],
	nameOf: (schema: DeclaredResponseSchema) => Promise<string>,
): Promise<string> {
	const statuses = new Map<number, Map<string, string>>();

	// A redirect has no body, so its output stays typed under 200 as before.
	const defaultStatus =
		info.status >= 300 && info.status < 400 ? 200 : info.status;
	statuses.set(defaultStatus, new Map([[info.responseType, outputName]]));

	for (const response of info.responses) {
		// A declared response replaces the default one at the same status.
		const content = new Map<string, string>();
		for (const [contentType, schema] of Object.entries(response.content)) {
			if (isBinarySchema(schema)) {
				content.set(contentType, 'Blob');
				continue;
			}
			const entry = declared.find(
				(d) => d.status === response.status && d.contentType === contentType,
			)!;
			content.set(contentType, await nameOf(entry));
		}
		statuses.set(response.status, content);
	}

	const entries = [...statuses].map(([status, content]) => {
		if (content.size === 0) {
			return `        ${status}: {\n          content?: never;\n        };`;
		}
		const types = [...content]
			.map(([type, name]) => `            '${type}': ${name};`)
			.join('\n');
		return `        ${status}: {\n          content: {\n${types}\n          };\n        };`;
	});

	return `responses: {\n${entries.join('\n')}\n      }`;
}
