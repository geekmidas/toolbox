import {
	answersProblems,
	documentedErrors,
	type EndpointError,
	PROBLEM_CONTENT_TYPE,
	VALIDATION_FAILED,
} from '@geekmidas/constructs/endpoints';
import { hasJsonSchema, toJsonSchema } from '@geekmidas/schema/conversion';

/** What the paths interface needs to know of an endpoint's refusals. */
export interface ProblemResponsesInfo {
	/** The refusals it documents, the 422 its input schemas send among them. */
	errors: EndpointError[];
	/** Whether its surface answers them as problem details. */
	problems: boolean;
}

/** An endpoint's refusals, as the paths interface prints them. */
export function problemResponsesOf(
	endpoint: Parameters<typeof documentedErrors>[0],
): ProblemResponsesInfo {
	return {
		errors: documentedErrors(endpoint),
		problems: answersProblems(endpoint),
	};
}

const VALIDATION_DETAILS = 'Array<{ message: string; path?: Array<unknown> }>';

/**
 * The `responses` entries for an endpoint's refusals, in openapi-typescript's
 * shape: each status with its `application/problem+json` body, whose `code`
 * is that status's codes. On a surface that answers with the default body,
 * each status is listed with no content, as the document lists it.
 *
 * `toTs` prints a JSON Schema as a type — the generator's own printer, so a
 * `details` schema reads as the rest of the client does.
 */
export function problemResponseEntries(
	info: ProblemResponsesInfo,
	toTs: (jsonSchema: any) => string,
): string {
	const byStatus = new Map<number, EndpointError[]>();
	for (const error of info.errors) {
		byStatus.set(error.status, [...(byStatus.get(error.status) ?? []), error]);
	}

	const entries: string[] = [];
	for (const [status, group] of [...byStatus].sort(([a], [b]) => a - b)) {
		if (!info.problems) {
			entries.push(
				`        ${status}: {\n          content?: never;\n        };`,
			);
			continue;
		}
		const codes = group.map((e) => `'${e.code.replace(/'/g, "\\'")}'`);
		const details = [
			...new Set(
				group
					.filter((e) => e.details || e.code === VALIDATION_FAILED)
					.map((e) => detailsType(e, toTs)),
			),
		];
		const problem = [
			'type: string',
			'title: string',
			'status: number',
			'detail: string',
			'instance?: string',
			`code: ${codes.join(' | ')}`,
			...(details.length ? [`details?: ${details.join(' | ')}`] : []),
		].join('; ');
		entries.push(
			`        ${status}: {\n          content: {\n            '${PROBLEM_CONTENT_TYPE}': { ${problem} };\n          };\n        };`,
		);
	}
	return entries.join('\n');
}

/**
 * The success's `responses` block with the refusals inside it, before its
 * closing brace.
 */
export function withProblemResponses(
	responses: string,
	info: ProblemResponsesInfo,
	toTs: (jsonSchema: any) => string,
): string {
	const entries = problemResponseEntries(info, toTs);
	const close = responses.lastIndexOf('}');
	if (!entries || close === -1) return responses;
	return `${responses.slice(0, close).trimEnd()}\n${entries}\n      ${responses.slice(close)}`;
}

function detailsType(
	error: EndpointError,
	toTs: (jsonSchema: any) => string,
): string {
	if (!error.details) return VALIDATION_DETAILS;
	if (!hasJsonSchema(error.details)) return 'unknown';
	try {
		const { $defs: _defs, ...schema } = toJsonSchema(error.details);
		return toTs(schema);
	} catch {
		return 'unknown';
	}
}
