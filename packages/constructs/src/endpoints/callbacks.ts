/**
 * Callbacks — the request an endpoint makes back to a URL its caller gave it.
 *
 * ```ts
 * api
 *   .post('/exports')
 *   .body(z.object({ callbackUrl: z.url() }))
 *   .callback('exportReady', {
 *     url: '{$request.body#/callbackUrl}',
 *     body: z.object({ exportId: z.string(), downloadUrl: z.url() }),
 *     response: { status: 204 },
 *   })
 *   .handle(async ({ body }) => …);
 * ```
 *
 * documents, under the operation's `callbacks`, the request the caller's
 * server will receive and what it is expected to answer.
 */
import { convertSchemaWithComponents } from '@geekmidas/schema/conversion';
import type { ComponentCollector } from '@geekmidas/schema/openapi';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { OpenAPIV3_1 } from 'openapi-types';

/** The answer an endpoint expects from the URL it calls back. */
export interface EndpointCallbackResponse {
	/** Defaults to 200. */
	status?: number;
	/** The body the receiver answers with, when it answers with one. */
	schema?: StandardSchemaV1;
	description?: string;
}

/** What `.callback(name, callback)` declares. */
export interface EndpointCallback {
	/**
	 * Where the request goes — an OpenAPI runtime expression, such as
	 * `{$request.body#/callbackUrl}` or `{$request.query.notify}/events`.
	 */
	url: string;
	/** Defaults to `post`. */
	method?: 'get' | 'post' | 'put' | 'patch' | 'delete';
	description?: string;
	/** The body sent to the URL. */
	body?: StandardSchemaV1;
	/** What the URL is expected to answer. Defaults to a 200. */
	response?: EndpointCallbackResponse;
}

/**
 * `.callback(name, …)` was called twice with the same name on one endpoint.
 */
export class CallbackDeclaredTwice extends Error {
	constructor(
		readonly callback: string,
		readonly endpoint: string,
	) {
		super(
			`'${endpoint}' declares callback '${callback}' twice. ` +
				'Give each callback its own name.',
		);
		this.name = 'CallbackDeclaredTwice';
	}
}

/**
 * The OpenAPI `callbacks` object for an operation: each name maps its URL
 * expression to the request sent there.
 */
export async function buildOpenApiCallbacks(
	callbacks: Readonly<Record<string, EndpointCallback>>,
	collector?: ComponentCollector,
): Promise<Record<string, OpenAPIV3_1.CallbackObject>> {
	const document: Record<string, OpenAPIV3_1.CallbackObject> = {};

	for (const [name, callback] of Object.entries(callbacks)) {
		const status = String(callback.response?.status ?? 200);
		const response: OpenAPIV3_1.ResponseObject = {
			description: callback.response?.description ?? 'Callback received',
		};
		const responseSchema = await convertSchemaWithComponents(
			callback.response?.schema,
			collector,
		);
		if (responseSchema) {
			response.content = { 'application/json': { schema: responseSchema } };
		}

		const operation: OpenAPIV3_1.OperationObject = {
			...(callback.description && { description: callback.description }),
			responses: { [status]: response },
		};

		const bodySchema = await convertSchemaWithComponents(
			callback.body,
			collector,
		);
		if (bodySchema) {
			operation.requestBody = {
				required: true,
				content: { 'application/json': { schema: bodySchema } },
			};
		}

		document[name] = {
			[callback.url]: { [callback.method ?? 'post']: operation },
		};
	}

	return document;
}
