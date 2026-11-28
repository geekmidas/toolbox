/**
 * The refusals an endpoint can answer, declared and documented, and the
 * RFC 9457 problem details a surface answers them with.
 *
 * An endpoint's document used to stop at its success response, so a client
 * generated from it knew nothing of the 409 a duplicate email gets or the 422
 * a malformed body gets. `.error(status, code, …)` names each refusal: its
 * status, a `code` that stays stable while the message is reworded, and the
 * shape of its `details`. The document carries each status under `responses`,
 * as `application/problem+json` referring to one shared `Problem` component,
 * with that status's codes as an enum.
 *
 * What goes on the wire is the surface's choice — `new RestApi('Api', {
 * errors: 'problem' })` — so a client written against today's body keeps
 * working until its API opts in.
 */

import { HttpError, isHttpError } from '@geekmidas/errors';
import { convertSchemaWithComponents } from '@geekmidas/schema/conversion';
import type { ComponentCollector } from '@geekmidas/schema/openapi';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { OpenAPIV3_1 } from 'openapi-types';
import type { EndpointSurface } from './Endpoint';

/** The media type of an RFC 9457 problem details body. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** The component every documented refusal refers to. */
export const PROBLEM_SCHEMA_ID = 'Problem';

/** The `code` of a request its body, query or params schema refused. */
export const VALIDATION_FAILED = 'VALIDATION_FAILED';

/**
 * How a surface answers a failed request.
 *
 * `'problem'` is RFC 9457 problem details, `application/problem+json`. Left
 * unset, a surface answers with the body it always has.
 */
export type ErrorFormat = 'problem';

/** A status a request can be refused or failed with. */
export type ErrorStatus =
	| 400
	| 401
	| 402
	| 403
	| 404
	| 405
	| 406
	| 408
	| 409
	| 410
	| 411
	| 412
	| 413
	| 414
	| 415
	| 416
	| 417
	| 418
	| 421
	| 422
	| 423
	| 424
	| 425
	| 426
	| 428
	| 429
	| 431
	| 451
	| 500
	| 501
	| 502
	| 503
	| 504
	| 505
	| 507
	| 508
	| 511;

/** What `.error(status, code, options)` says beside the status and code. */
export interface EndpointErrorOptions {
	/** What the refusal means, for the document's response description. */
	description?: string;
	/** The shape of the problem's `details`. */
	details?: StandardSchemaV1;
}

/** One refusal an endpoint can answer. */
export interface EndpointError extends EndpointErrorOptions {
	status: ErrorStatus;
	/** Stable across rewordings of the message; what a client matches on. */
	code: string;
}

/** An RFC 9457 problem details body, with the toolbox's `code` and `details`. */
export interface Problem<TCode extends string = string, TDetails = unknown> {
	/** `about:blank`: the status says what kind of problem it is. */
	type: string;
	/** The status's reason phrase — `Conflict`. */
	title: string;
	status: number;
	/** What went wrong with this request — the error's message. */
	detail: string;
	code?: TCode;
	details?: TDetails;
}

/** Thrown by `.error()` for a status that is not a 4xx or 5xx. */
export class ErrorStatusNotARefusal extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(
			`.error(${status}, '${code}') declares a refusal, and a refusal is answered with a 4xx or 5xx status. Declare the success status with .status() instead.`,
		);
		this.name = 'ErrorStatusNotARefusal';
	}
}

/** One declared refusal, checked. */
export function endpointError(
	status: ErrorStatus,
	code: string,
	options: EndpointErrorOptions = {},
): EndpointError {
	if (!Number.isInteger(status) || status < 400 || status > 599) {
		throw new ErrorStatusNotARefusal(status, code);
	}
	return { status, code, ...options };
}

/**
 * The refusals an endpoint answers: its branch's, then its own. A code
 * declared twice under one status is the endpoint's.
 */
export function mergeEndpointErrors(
	...lists: ReadonlyArray<readonly EndpointError[] | undefined>
): EndpointError[] {
	const byKey = new Map<string, EndpointError>();
	for (const list of lists) {
		for (const error of list ?? []) {
			byKey.set(`${error.status} ${error.code}`, error);
		}
	}
	return [...byKey.values()];
}

/**
 * The surface a branch's `.error()` hands its endpoints: the same surface,
 * with one more refusal every endpoint built from the branch declares.
 */
export function withSurfaceError(
	surface: EndpointSurface,
	error: EndpointError,
): EndpointSurface {
	return {
		...surface,
		refusals: mergeEndpointErrors(surface.refusals, [error]),
	};
}

/** Whether an endpoint's surface answers failures as problem details. */
export function answersProblems(endpoint: {
	surface?: EndpointSurface;
}): boolean {
	return endpoint.surface?.errors === 'problem';
}

/**
 * The problem details for `error`.
 *
 * A server failure's `details` are what it wrapped — a variable it could not
 * read, a query that failed — so they reach the response only under
 * `gkm dev`, as with the default body; a 4xx's details are the client's.
 */
export function problemOf(
	error: HttpError,
	options: { isDev: boolean },
): Problem {
	const internal = error.statusCode >= 500 && !options.isDev;
	return {
		type: 'about:blank',
		title: error.statusMessage,
		status: error.statusCode,
		detail: error.message,
		...(error.code !== undefined ? { code: error.code } : {}),
		...(!internal && error.details !== undefined
			? { details: error.details }
			: {}),
	};
}

/** A request its input schemas refused, as the 422 a problem surface sends. */
export function validationFailed(
	issues: readonly StandardSchemaV1.Issue[],
): HttpError {
	return new HttpError(422, 'Validation failed', {
		code: VALIDATION_FAILED,
		details: issues,
	});
}

/**
 * What an input schema's refusal is on a problem surface: the issues — bare,
 * or wrapped in the `UnprocessableEntityError` parsing throws — as a
 * `VALIDATION_FAILED` 422. Anything else is returned as it was.
 */
export function asValidationFailed(error: unknown): unknown {
	if (Array.isArray(error)) return validationFailed(error);
	if (
		isHttpError(error) &&
		error.statusCode === 422 &&
		error.code === undefined &&
		Array.isArray(error.details?.validationErrors)
	) {
		return validationFailed(error.details.validationErrors);
	}
	return error;
}

/** The problem response an API Gateway Lambda answers `error` with. */
export function lambdaProblem(error: HttpError): {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
} {
	return {
		statusCode: error.statusCode,
		headers: {
			...(error.headers ?? {}),
			'Content-Type': PROBLEM_CONTENT_TYPE,
		},
		body: JSON.stringify(
			problemOf(error, { isDev: process.env.NODE_ENV === 'development' }),
		),
	};
}

/** The `Problem` component: RFC 9457's members, and `code` and `details`. */
export const PROBLEM_SCHEMA: OpenAPIV3_1.SchemaObject = {
	type: 'object',
	description: 'An RFC 9457 problem details object.',
	properties: {
		type: {
			type: 'string',
			description: 'A URI reference that identifies the problem type.',
			default: 'about:blank',
		},
		title: {
			type: 'string',
			description: "The status's reason phrase.",
		},
		status: { type: 'integer', description: 'The HTTP status code.' },
		detail: {
			type: 'string',
			description: 'What went wrong with this request.',
		},
		instance: { type: 'string' },
		code: {
			type: 'string',
			description: 'A stable code for the refusal, to match on.',
		},
		details: {},
	},
	required: ['type', 'title', 'status', 'detail'],
};

const VALIDATION_DETAILS: OpenAPIV3_1.SchemaObject = {
	type: 'array',
	items: {
		type: 'object',
		properties: {
			message: { type: 'string' },
			path: { type: 'array', items: {} },
		},
		required: ['message'],
	},
};

/** A status's reason phrase, as `HttpError` gives it. */
function reasonPhrase(status: number): string {
	return new HttpError(status).statusMessage;
}

/**
 * The refusals an endpoint documents: each it declared, and on a problem
 * surface, the 422 its input schemas answer with.
 */
export function documentedErrors(endpoint: {
	surface?: EndpointSurface;
	errors?: readonly EndpointError[];
	input?: unknown;
}): EndpointError[] {
	const declared = mergeEndpointErrors(
		endpoint.surface?.refusals,
		endpoint.errors,
	);
	const input = endpoint.input as Record<string, unknown> | undefined;
	const validates = !!(input?.body || input?.query || input?.params);
	if (!answersProblems(endpoint) || !validates) return declared;
	if (declared.some((e) => e.status === 422 && e.code === VALIDATION_FAILED)) {
		return declared;
	}
	return [
		{
			status: 422,
			code: VALIDATION_FAILED,
			description: 'The request did not match its schema.',
		},
		...declared,
	];
}

/** Declared refusals, grouped by status in ascending order. */
export function errorsByStatus(
	errors: readonly EndpointError[],
): Array<[ErrorStatus, EndpointError[]]> {
	const groups = new Map<ErrorStatus, EndpointError[]>();
	for (const error of errors) {
		groups.set(error.status, [...(groups.get(error.status) ?? []), error]);
	}
	return [...groups.entries()].sort(([a], [b]) => a - b);
}

/**
 * Adds an endpoint's refusals to its operation's `responses`.
 *
 * On a problem surface each status is `application/problem+json`, referring
 * to the shared `Problem` and narrowing its `code` to the codes declared for
 * that status. A surface that answers with the default body documents the
 * statuses and what they mean, and claims no body it does not send.
 */
export async function addErrorResponses(
	operation: OpenAPIV3_1.OperationObject,
	endpoint: {
		surface?: EndpointSurface;
		errors?: readonly EndpointError[];
		input?: unknown;
	},
	collector?: ComponentCollector,
): Promise<void> {
	const errors = documentedErrors(endpoint);
	if (errors.length === 0) return;

	const problems = answersProblems(endpoint);
	if (problems) collector?.addSchema(PROBLEM_SCHEMA_ID, PROBLEM_SCHEMA);
	const problem = collector
		? collector.getReference(PROBLEM_SCHEMA_ID)
		: PROBLEM_SCHEMA;

	operation.responses ??= {};
	for (const [status, group] of errorsByStatus(errors)) {
		const description =
			group
				.map((e) => e.description)
				.filter(Boolean)
				.join(' ') || reasonPhrase(status);
		const response: OpenAPIV3_1.ResponseObject = { description };

		if (problems) {
			const details: OpenAPIV3_1.SchemaObject[] = [];
			for (const error of group) {
				const schema =
					error.code === VALIDATION_FAILED && !error.details
						? VALIDATION_DETAILS
						: await convertSchemaWithComponents(error.details, collector);
				if (schema) details.push(schema);
			}
			const narrowed: OpenAPIV3_1.SchemaObject = {
				type: 'object',
				properties: {
					code: { type: 'string', enum: group.map((e) => e.code) },
					...(details.length === 1
						? { details: details[0] }
						: details.length > 1
							? { details: { anyOf: details } }
							: {}),
				},
				required: ['code'],
			};
			response.content = {
				[PROBLEM_CONTENT_TYPE]: { schema: { allOf: [problem, narrowed] } },
			};
		}

		operation.responses[String(status)] = response;
	}
}
