import type {
	AuditableAction,
	AuditStorage,
	ExtractStorageAuditAction,
} from '@geekmidas/audit';
import type { Logger } from '@geekmidas/logger';
import type { RateLimitConfig } from '@geekmidas/rate-limit';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service } from '@geekmidas/services';
import type { StorageClient } from '@geekmidas/storage';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import uniqBy from 'lodash.uniqby';
import { ConstructType } from '../Construct';
import { cloneWith } from '../clone';
import {
	type Consumable,
	idsOf,
	type ServicesOf,
	serviceOf,
	servicesOf,
} from '../construct-interface';
import { BaseFunctionBuilder } from '../functions';
import type { EventFor } from '../publisher';
import type { EndpointTelemetry } from '../telemetry';
import type { Topic } from '../topic/Topic';
import type { HttpMethod } from '../types';
import type {
	Authorizer,
	AuthorizerOptions,
	AuthorizerRequirement,
	SecurityScheme,
} from './Authorizer';
import {
	assertAuthorizerAvailable,
	NoAuthorizersGiven,
	normalizeAuthorizerRequirement,
	resolveAuthorizer,
} from './Authorizer';
import type { ActorExtractor, MappedAudit } from './audit';
import { CallbackDeclaredTwice, type EndpointCallback } from './callbacks';
import type {
	AuthorizeFn,
	EndpointContext,
	EndpointHandler,
	EndpointStatus,
	EndpointTag,
	OperationExtensions,
	SessionFn,
} from './Endpoint';
import {
	Endpoint,
	type EndpointSchemas,
	type EndpointSurface,
	withTag,
} from './Endpoint';
import {
	type EndpointError,
	type EndpointErrorOptions,
	type ErrorStatus,
	endpointError,
	mergeEndpointErrors,
} from './problems';
import {
	type DeclaredResponse,
	declareResponse,
	type ResponseContent,
	type ResponseOptions,
	type WithResponse,
} from './responses';
import {
	type RequestHeadersInput,
	type RequestHeadersSchema,
	type ResponseHeaders,
	requestHeadersSchema,
} from './headers';
import type { RlsBypass, RlsConfig } from './rls';
import { RLS_BYPASS } from './rls';
import {
	checkUploadOptions,
	issueUpload,
	UPLOAD_POST_SCHEMA,
	type UploadOptions,
	type UploadPost,
} from './upload';

/**
 * A key given to `.extensions()` that is not a vendor extension. OpenAPI
 * reserves every other key on an operation for fields it defines.
 */
export class NotAnExtension extends Error {
	constructor(readonly key: string) {
		super(
			`'${key}' is not a vendor extension. Name it 'x-${key}': only x- keys can be added to an operation, and the fields OpenAPI defines are written from the endpoint — .summary(), .description(), .tags(), .deprecated().`,
		);
		this.name = 'NotAnExtension';
	}
}

export class EndpointBuilder<
	TRoute extends string,
	TMethod extends HttpMethod,
	TInput extends EndpointSchemas = {},
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TSession = unknown,
	TAuthorizers extends readonly string[] = readonly string[],
	TAuditStorage extends AuditStorage | undefined = undefined,
	TAuditStorageServiceName extends string = string,
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> extends BaseFunctionBuilder<
	TInput,
	OutSchema,
	TServices,
	TLogger,
	TAuditStorage,
	TAuditStorageServiceName,
	TDatabase,
	TDatabaseServiceName
> {
	protected schemas: TInput = {} as TInput;
	protected _description?: string;
	protected _status?: EndpointStatus;
	/** Its tags, in order, each with the description it was given. */
	_tagList: EndpointTag[] = [];
	protected _summary?: string;
	protected _deprecated?: boolean;
	protected _extensions?: OperationExtensions;
	protected _memorySize?: number;
	protected _responseType: string = 'application/json';
	/** Set by a factory's `.session()`; absent, the endpoint reads none. */
	_getSession?: SessionFn<TServices, TLogger, TSession, TDatabase>;
	_authorize: AuthorizeFn<TServices, TLogger, TSession, TInput, TDatabase> =
		() => true;
	_rateLimit?: RateLimitConfig;
	_availableAuthorizers: Authorizer[] = [];
	_authorizerName?: TAuthorizers[number];
	/**
	 * Every authorizer the endpoint accepts, with scopes — set by
	 * `.authorizer(name, { scopes })`, `.authorizers([...])` or a factory
	 * default with scopes. Absent, `_authorizerName` alone with none.
	 */
	_security?: { name: string; scopes: string[] }[];
	_actorExtractor?: ActorExtractor<TServices, TSession, TLogger>;
	_audits: MappedAudit<TAuditAction, OutSchema>[] = [];
	/**
	 * Internal: the surface this builder came from, carried to the endpoint.
	 *
	 * Assigned by the factory before the builder is handed out, which is the
	 * only way a builder is ever created.
	 */
	_surface!: EndpointSurface;
	_customSecuritySchemes: Record<string, SecurityScheme> = {};
	_rlsConfig?: RlsConfig<TServices, TSession, TLogger>;
	_rlsBypass?: boolean;
	_telemetry?: EndpointTelemetry;
	_callbacks?: Record<string, EndpointCallback>;
	_errors: EndpointError[] = [];
	_responses: DeclaredResponse[] = [];
	_responseHeaders?: ResponseHeaders;

	constructor(
		readonly route: TRoute,
		readonly method: TMethod,
	) {
		super(ConstructType.Endpoint);
	}

	// Internal setter for EndpointFactory to set default auditor storage
	_setAuditorStorage(
		storage: Service<TAuditStorageServiceName, TAuditStorage>,
	) {
		this._auditorStorage = storage;
	}

	// Internal setter for EndpointFactory to set default database service
	_setDatabaseService(service: Service<TDatabaseServiceName, TDatabase>) {
		this._databaseService = service;
	}

	description(description: string): this {
		return cloneWith(this, { _description: description });
	}

	/**
	 * The status a successful request is answered with — a 2xx, or a 3xx for
	 * an endpoint that always redirects (with a `Location` header). One that
	 * sometimes redirects returns `response.redirect(url)` instead.
	 */
	status(status: EndpointStatus): this {
		return cloneWith(this, { _status: status });
	}

	/**
	 * Publish `event` to `topic` once the handler has succeeded — repeatable,
	 * one call per event, to as many topics as the endpoint names. The topic
	 * becomes a dependency as with `.dependsOn([topic])`, so `services.<topic>`
	 * is there for events the handler decides on itself.
	 *
	 * @example
	 * ```ts
	 * router.post('/users')
	 *   .event(users, {
	 *     type: 'user.created',
	 *     payload: (user) => ({ userId: user.id, email: user.email }),
	 *   })
	 * ```
	 */
	event<TTopic extends Topic<any, any>>(
		topic: TTopic,
		event: EventFor<TTopic, InferStandardSchema<OutSchema>>,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		[...TServices, TTopic['service']],
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.withEvent(topic, event as never) as unknown as EndpointBuilder<
			TRoute,
			TMethod,
			TInput,
			[...TServices, TTopic['service']],
			TLogger,
			OutSchema,
			TSession,
			TAuthorizers,
			TAuditStorage,
			TAuditStorageServiceName,
			TAuditAction,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * Group the endpoint under a tag — a section of the API reference. Adds
	 * to the tags it has, including those of the factory it came from
	 * (`api.tag(…)`), so it chains.
	 */
	tag(name: string, description?: string): this {
		return cloneWith(this, {
			_tagList: withTag(this._tagList, { name, description }),
		});
	}

	/** Several tags at once, by name — `.tag()` for each. */
	tags(tags: string[]): this {
		return cloneWith(this, {
			_tagList: tags.reduce(
				(list, name) => withTag(list, { name }),
				this._tagList,
			),
		});
	}

	/**
	 * A one-line summary of what the endpoint does — the line an API
	 * reference lists it under. `.description()` is the longer text beneath.
	 */
	summary(summary: string): this {
		return cloneWith(this, { _summary: summary });
	}

	/**
	 * Mark the endpoint deprecated: `deprecated: true` in the document, and
	 * `@deprecated` on its entry in the generated client. It still serves.
	 */
	deprecated(deprecated = true): this {
		return cloneWith(this, { _deprecated: deprecated });
	}

	/**
	 * Vendor extensions written onto the endpoint's operation, merged with
	 * any given before. Only `x-` keys; what OpenAPI defines is written from
	 * the endpoint itself.
	 *
	 * @example
	 * ```ts
	 * router.get('/internal/stats').extensions({ 'x-internal': true })
	 * ```
	 */
	extensions(extensions: OperationExtensions): this {
		for (const key of Object.keys(extensions)) {
			if (!key.startsWith('x-')) throw new NotAnExtension(key);
		}
		return cloneWith(this, {
			_extensions: { ...this._extensions, ...extensions },
		});
	}

	/**
	 * A request this endpoint makes back to a URL its caller gave it,
	 * documented under the operation's `callbacks`. Repeatable, one name each.
	 *
	 * @example
	 * ```ts
	 * api.post('/exports')
	 *   .body(z.object({ callbackUrl: z.url() }))
	 *   .callback('exportReady', {
	 *     url: '{$request.body#/callbackUrl}',
	 *     body: z.object({ exportId: z.string() }),
	 *     response: { status: 204 },
	 *   })
	 * ```
	 */
	callback(name: string, callback: EndpointCallback): this {
		if (this._callbacks && name in this._callbacks) {
			throw new CallbackDeclaredTwice(name, `${this.method} ${this.route}`);
		}
		return cloneWith(this, {
			_callbacks: { ...this._callbacks, [name]: callback },
		});
	}

	/**
	 * A refusal this endpoint can answer — repeatable, one call per code. The
	 * document lists each status under `responses`, as
	 * `application/problem+json` with the status's codes as an enum. The
	 * handler answers it by throwing an `HttpError` with that status and code.
	 *
	 * @example
	 * ```ts
	 * router.post('/users')
	 *   .error(409, 'EMAIL_TAKEN', { description: 'The email is registered.' })
	 *   .handle(async () => {
	 *     throw createHttpError(409, 'Email taken', { code: 'EMAIL_TAKEN' });
	 *   });
	 * ```
	 */
	error(
		status: ErrorStatus,
		code: string,
		options?: EndpointErrorOptions,
	): this {
		const declared = endpointError(status, code, options);
		return cloneWith(this, {
			_errors: mergeEndpointErrors(this._errors, [declared]),
		});
	}

	memorySize(memorySize: number): this {
		return cloneWith(this, { _memorySize: memorySize });
	}

	/**
	 * This route's telemetry, beside what its surface's `Telemetry` says for
	 * every route: `{ ignore: true }` records no span for it — a health check,
	 * a probe — and `attributes` are set on its request span.
	 *
	 * @example
	 * ```ts
	 * router.get('/health').telemetry({ ignore: true }).handle(() => 'ok');
	 * ```
	 */
	telemetry(options: EndpointTelemetry): this {
		return cloneWith(this, { _telemetry: { ...options } });
	}

	/**
	 * Set the response content type for this endpoint.
	 *
	 * Defaults to `'application/json'`. When set to any other value
	 * (e.g. `'text/html'`, `'text/plain'`), the response body is emitted
	 * as-is rather than JSON-serialized, and the `Content-Type` header
	 * reflects the declared value. Runtime overrides via `r.header()` still win.
	 *
	 * @param type - The MIME type to return (e.g. `'text/html'`)
	 *
	 * @example
	 * ```typescript
	 * api.get('/checkout-page')
	 *   .output(z.string())
	 *   .responseType('text/html')
	 *   .handle(async () => '<html>...</html>');
	 * ```
	 */
	responseType(type: string): this {
		return cloneWith(this, { _responseType: type });
	}

	/**
	 * Another response the handler may answer with, beside the default one
	 * `.output()`, `.status()` and `.responseType()` describe — repeatable.
	 * `content` is a schema (JSON) or a schema per content type; `binary()`
	 * declares bytes. Declare it after `.output()`, which starts the types over.
	 *
	 * When the handler answers `status` (`response.status(200)`), the body is
	 * checked against this response rather than `.output()`, in the content
	 * type the handler set (`response.header('content-type', 'text/csv')`) or
	 * the first one listed; one that is not JSON is emitted as-is. Declared
	 * events and audits follow `.output()`, so they are not sent for it.
	 *
	 * @example
	 * ```typescript
	 * api.put('/orders/:id')
	 *   .output(Order)
	 *   .status(201)
	 *   .response(200, Order, { description: 'A retry: the original order' })
	 *   .response(202, undefined, { description: 'Queued' })
	 *   .handle(async ({ params }, response) => …);
	 *
	 * api.get('/reports/:id')
	 *   .response(200, {
	 *     'application/json': Report,
	 *     'text/csv': z.string(),
	 *     'application/pdf': binary(),
	 *   })
	 *   .handle(async ({ header }, response) => …);
	 * ```
	 */
	response<
		TStatus extends EndpointStatus,
		TContent extends ResponseContent | undefined = undefined,
	>(
		status: TStatus,
		content?: TContent,
		options?: ResponseOptions,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		TServices,
		TLogger,
		WithResponse<OutSchema, TStatus, TContent>,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_responses: [
				...this._responses,
				declareResponse(status, content, options),
			],
		}) as never;
	}

	body<T extends StandardSchemaV1>(
		schema: T,
	): EndpointBuilder<
		TRoute,
		TMethod,
		Omit<TInput, 'body'> & { body: T },
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		this.schemas.body = schema as unknown as T;
		// @ts-expect-error
		return this;
	}

	search<T extends StandardSchemaV1>(
		schema: T,
	): EndpointBuilder<
		TRoute,
		TMethod,
		Omit<TInput, 'query'> & { query: T },
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		this.schemas.query = schema as unknown as T;
		// @ts-expect-error
		return this;
	}

	query<T extends StandardSchemaV1>(
		schema: T,
	): EndpointBuilder<
		TRoute,
		TMethod,
		Omit<TInput, 'query'> & { query: T },
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		return this.search(schema);
	}

	params<T extends StandardSchemaV1>(
		schema: T,
	): EndpointBuilder<
		TRoute,
		TMethod,
		Omit<TInput, 'params'> & { params: T },
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		this.schemas.params = schema as unknown as T;
		// @ts-expect-error
		return this;
	}

	/**
	 * The request headers the endpoint reads — validated like the query, and
	 * handed to the handler as `headers`, keyed by lower-case name. A missing
	 * required header, or one its schema refuses, is answered with 400.
	 *
	 * Give an object schema whose keys are lower-case, or the headers one by
	 * one — each a schema or a shared `defineHeader()` — under their names.
	 *
	 * @example
	 * ```ts
	 * router
	 *   .post('/payments')
	 *   .headers({ 'Idempotency-Key': IdempotencyKey, 'if-match': z.string().optional() })
	 *   .handle(async ({ headers }) => headers['idempotency-key']);
	 * ```
	 */
	headers<const T extends RequestHeadersInput>(
		headers: T,
	): EndpointBuilder<
		TRoute,
		TMethod,
		Omit<TInput, 'headers'> & { headers: RequestHeadersSchema<T> },
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		(this.schemas as EndpointSchemas).headers = requestHeadersSchema(headers);
		// @ts-expect-error
		return this;
	}

	/**
	 * The headers a successful response carries — `ETag`, `Location`,
	 * `Retry-After` — documented under the response, each given inline or as a
	 * shared `defineHeader()`. Adds to any declared before. The handler still
	 * sets them, with `response.header()`.
	 *
	 * @example
	 * ```ts
	 * router
	 *   .get('/things/:id')
	 *   .responseHeaders({ ETag, 'Cache-Control': { description: 'How long to keep it' } })
	 * ```
	 */
	responseHeaders(headers: ResponseHeaders): this {
		return cloneWith(this, {
			_responseHeaders: { ...this._responseHeaders, ...headers },
		});
	}

	authorize(
		fn: AuthorizeFn<TServices, TLogger, TSession, TInput, TDatabase>,
	): this {
		return cloneWith(this, { _authorize: fn });
	}

	rateLimit(config: RateLimitConfig): this {
		return cloneWith(this, { _rateLimit: config });
	}

	/**
	 * The authorizer that guards this endpoint, and the scopes a caller's
	 * credential must carry: `.authorizer('oauth', { scopes: ['orders:read'] })`.
	 * `'none'` makes it public.
	 */
	authorizer(
		name: TAuthorizers[number] | 'none',
		options?: AuthorizerOptions,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		// Special case: 'none' explicitly marks endpoint as having no authorizer
		if (name === 'none') {
			return cloneWith(this, {
				_authorizerName: undefined,
				_security: undefined,
			});
		}

		// Validate that the authorizer exists in available authorizers
		assertAuthorizerAvailable(name as string, this._availableAuthorizers);

		return cloneWith(this, {
			_authorizerName: name,
			_security: [
				{ name: name as string, scopes: [...(options?.scopes ?? [])] },
			],
		});
	}

	/**
	 * Several ways to call this endpoint, any one of which is enough — a
	 * session cookie, or an OAuth 2 token with a scope:
	 *
	 * ```typescript
	 * .authorizers(['session', { name: 'oauth', scopes: ['orders:read'] }])
	 * ```
	 *
	 * The first is the endpoint's `authorizer`, the one a gateway enforces;
	 * the OpenAPI document lists them all as alternatives.
	 */
	authorizers(
		alternatives: readonly AuthorizerRequirement<TAuthorizers[number]>[],
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		const security = alternatives.map(normalizeAuthorizerRequirement);
		const [first] = security;
		if (!first) {
			throw new NoAuthorizersGiven(`${this.method} ${this.route}`);
		}
		for (const { name } of security) {
			assertAuthorizerAvailable(name, this._availableAuthorizers);
		}

		return cloneWith(this, {
			_authorizerName: first.name as TAuthorizers[number],
			_security: security,
		});
	}

	/**
	 * Depend on constructs — a database, a bucket, a mail sender, a queue, a
	 * topic.
	 *
	 * It records the edge and dissolves each construct's client into the
	 * handler's service record under the construct's own id, so
	 * `.dependsOn([uploads])` is what makes `services.uploads` exist and type.
	 *
	 * Constructs only. A `Service` does not match the shape, which is what keeps
	 * env sniffing confined to `.services()` and the explicit lift.
	 */
	dependsOn<const T extends readonly Consumable[]>(
		constructs: T,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		[...TServices, ...ServicesOf<T>],
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		// Both halves of the edge, from one call and one clone: the services the
		// handler runs with, and the ids the manifest records. Recording them
		// separately is what let them drift apart.
		//
		// `servicesOf` is the half that validates, so it runs first — recording
		// ids ahead of it left a caught `NotAConstruct` with `undefined` already
		// on a `string[]`.
		const services = servicesOf(constructs) as unknown as Service[];

		return cloneWith(this, {
			_services: uniqBy(
				[...this._services, ...services],
				(service: Service) => service.serviceName,
			),
			_constructs: idsOf(constructs, this._constructs),
		}) as unknown as EndpointBuilder<
			TRoute,
			TMethod,
			TInput,
			[...TServices, ...ServicesOf<T>],
			TLogger,
			OutSchema,
			TSession,
			TAuthorizers,
			TAuditStorage,
			TAuditStorageServiceName,
			TAuditAction,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * Hand the browser a signed form that uploads one file straight to
	 * `bucket` — the file never passes through this server.
	 *
	 * The endpoint decides where (`key`, from what the handler is given) and
	 * the form's policy decides what: the storage refuses a file over
	 * `maxSize`, or of a type `accept` does not allow. The handler receives
	 * the form as `upload`, and returns it unless it has more to say — it is
	 * the endpoint's output when no `.output()` came first. The bucket
	 * becomes a dependency, as with `.dependsOn([bucket])`.
	 *
	 * The last step before `.handle()`: the key is resolved from the body,
	 * params and session, so they are declared first.
	 *
	 * @example
	 * ```ts
	 * router
	 *   .post('/me/avatar')
	 *   .upload(uploads, {
	 *     key: ({ session }) => `avatars/${session.userId}.png`,
	 *     maxSize: 5 * 1024 * 1024,
	 *     accept: ['image/png'],
	 *   })
	 *   .handle(async ({ upload }) => upload);
	 * ```
	 */
	upload<TBucket extends Consumable<string, StorageClient>>(
		bucket: TBucket,
		options: UploadOptions<
			EndpointContext<
				TInput,
				[...TServices, TBucket['service']],
				TLogger,
				TSession,
				TAuditAction,
				TDatabase,
				TAuditStorage
			>
		>,
	): UploadEndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		[...TServices, TBucket['service']],
		TLogger,
		[OutSchema] extends [undefined] ? typeof UPLOAD_POST_SCHEMA : OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		checkUploadOptions(options);
		const [service] = servicesOf([bucket]) as unknown as Service[];

		const next = Object.create(UploadEndpointBuilder.prototype);
		return Object.assign(next, this, {
			_services: uniqBy(
				[...this._services, service!],
				(s: Service) => s.serviceName,
			),
			_constructs: idsOf([bucket], this._constructs),
			outputSchema: this.outputSchema ?? UPLOAD_POST_SCHEMA,
			_upload: { serviceName: service!.serviceName, options },
		});
	}

	services<T extends Service[]>(
		services: T,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		[...TServices, ...T],
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_services: uniqBy(
				[...this._services, ...services],
				(s) => s.serviceName,
			) as TServices,
		}) as unknown as EndpointBuilder<
			TRoute,
			TMethod,
			TInput,
			[...TServices, ...T],
			TLogger,
			OutSchema,
			TSession,
			TAuthorizers,
			TAuditStorage,
			TAuditStorageServiceName,
			TAuditAction,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	logger<T extends Logger>(
		logger: T,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		TServices,
		T,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_logger: logger as unknown as TLogger,
		}) as unknown as EndpointBuilder<
			TRoute,
			TMethod,
			TInput,
			TServices,
			T,
			OutSchema,
			TSession,
			TAuthorizers,
			TAuditStorage,
			TAuditStorageServiceName,
			TAuditAction,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	output<T extends StandardSchemaV1>(
		schema: T,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		TServices,
		TLogger,
		T,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			outputSchema: schema as unknown as OutSchema,
		}) as unknown as EndpointBuilder<
			TRoute,
			TMethod,
			TInput,
			TServices,
			TLogger,
			T,
			TSession,
			TAuthorizers,
			TAuditStorage,
			TAuditStorageServiceName,
			TAuditAction,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * Set the auditor storage service for this endpoint.
	 * This enables audit functionality and makes `auditor` available in the handler context.
	 * The audit action type is automatically inferred from the storage's generic parameter.
	 */
	override auditor<T extends AuditStorage<any>, TName extends string>(
		storage: Service<TName, T>,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		T,
		TName,
		ExtractStorageAuditAction<T>,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, {
			_auditorStorage: storage as unknown as Service<
				TAuditStorageServiceName,
				TAuditStorage
			>,
		}) as unknown as EndpointBuilder<
			TRoute,
			TMethod,
			TInput,
			TServices,
			TLogger,
			OutSchema,
			TSession,
			TAuthorizers,
			T,
			TName,
			ExtractStorageAuditAction<T>,
			TDatabase,
			TDatabaseServiceName
		>;
	}

	/**
	 * Set the actor extractor function for audit records.
	 * The actor is extracted from the request context and attached to all audits.
	 */
	actor(
		extractor: ActorExtractor<TServices, TSession, TLogger>,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		return cloneWith(this, { _actorExtractor: extractor });
	}

	/**
	 * Add declarative audit definitions that are processed after the handler executes.
	 * Similar to `.event()` for events, but for audits.
	 *
	 * @example
	 * ```typescript
	 * .audit<AppAuditAction>([
	 *   {
	 *     type: 'user.created',
	 *     payload: (response) => ({ userId: response.id, email: response.email }),
	 *     when: (response) => response.active,
	 *     entityId: (response) => response.id,
	 *     table: 'users',
	 *   },
	 * ])
	 * ```
	 */
	audit(audits: MappedAudit<TAuditAction, OutSchema>[]): this {
		return cloneWith(this, { _audits: audits });
	}

	/**
	 * Set the database service for this endpoint.
	 * The database will be available in the handler context as `db`.
	 * When audit storage is configured and uses the same database,
	 * `db` will automatically be the transaction for ACID compliance.
	 *
	 * @example
	 * ```typescript
	 * .database(databaseService)
	 * .handle(async ({ db }) => {
	 *   // db is the raw database or transaction (when auditor uses same db)
	 *   return await db.selectFrom('users').selectAll().execute();
	 * })
	 * ```
	 */
	override database<T, TName extends string>(
		source: Consumable<TName, T> | Service<TName, T>,
	): EndpointBuilder<
		TRoute,
		TMethod,
		TInput,
		TServices,
		TLogger,
		OutSchema,
		TSession,
		TAuthorizers,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		T,
		TName
	> {
		const service = serviceOf(source);

		return cloneWith(this, {
			_databaseService: service as unknown as Service<
				TDatabaseServiceName,
				TDatabase
			>,
		}) as unknown as EndpointBuilder<
			TRoute,
			TMethod,
			TInput,
			TServices,
			TLogger,
			OutSchema,
			TSession,
			TAuthorizers,
			TAuditStorage,
			TAuditStorageServiceName,
			TAuditAction,
			T,
			TName
		>;
	}

	/**
	 * Configure RLS (Row-Level Security) context for this endpoint.
	 * Pass `false` or `RLS_BYPASS` to explicitly bypass RLS for this endpoint.
	 *
	 * @example
	 * ```typescript
	 * // Custom RLS config for this endpoint
	 * .rls({
	 *   extractor: ({ session }) => ({
	 *     user_id: session.userId,
	 *     tenant_id: session.tenantId,
	 *   }),
	 *   prefix: 'app',
	 * })
	 *
	 * // Bypass RLS (for admin endpoints)
	 * .rls(false)
	 * ```
	 */
	rls(
		config: RlsConfig<TServices, TSession, TLogger> | false | RlsBypass,
	): this {
		if (config === false || config === RLS_BYPASS) {
			this._rlsBypass = true;
			this._rlsConfig = undefined;
		} else {
			this._rlsConfig = config;
			this._rlsBypass = false;
		}
		return this;
	}

	/**
	 * Explicitly bypass RLS for this endpoint.
	 * Useful for admin operations that need unrestricted database access.
	 *
	 * @example
	 * ```typescript
	 * .rlsBypass()
	 * .handle(async ({ db }) => {
	 *   // Full access, no RLS filtering
	 *   return db.selectFrom('orders').selectAll().execute();
	 * })
	 * ```
	 */
	rlsBypass(): this {
		return cloneWith(this, { _rlsBypass: true, _rlsConfig: undefined });
	}

	// EndpointBuilder doesn't have a generic input method - it uses body, query, params instead
	input(_schema: any): any {
		throw new Error(
			'EndpointBuilder does not support generic input. Use body(), query(), or params() instead.',
		);
	}

	handle(
		fn: EndpointHandler<
			TInput,
			TServices,
			TLogger,
			OutSchema,
			TSession,
			TDatabase,
			TAuditStorage,
			TAuditAction
		>,
	): Endpoint<
		TRoute,
		TMethod,
		TInput,
		OutSchema,
		TServices,
		TLogger,
		TSession,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		// Each authorizer it accepts, resolved to its scheme (the factory's own,
		// a built-in, or a custom one); the first is the endpoint's `authorizer`.
		const security = (
			this._security ??
			(this._authorizerName
				? [{ name: this._authorizerName as string, scopes: [] }]
				: [])
		).map(({ name, scopes }) => ({
			authorizer: resolveAuthorizer(
				name,
				this._availableAuthorizers,
				this._customSecuritySchemes,
			),
			scopes,
		}));
		const authorizer: Authorizer | undefined = security[0]?.authorizer;

		const endpoint = new Endpoint({
			fn,
			method: this.method,
			route: this.route,
			description: this._description,
			...(this._tagList.length ? { tags: this._tagList } : {}),
			...(this._summary ? { summary: this._summary } : {}),
			...(this._deprecated ? { deprecated: true } : {}),
			...(this._extensions ? { extensions: this._extensions } : {}),
			input: this.schemas,
			output: this.outputSchema,
			services: this._services,
			constructs: this._constructs,
			logger: this._logger,
			timeout: this._timeout,
			memorySize: this._memorySize,
			authorize: this._authorize,
			status: this._status,
			getSession: this._getSession,
			rateLimit: this._rateLimit,
			events: this._events,
			authorizer,
			security,
			surface: this._surface,
			auditorStorageService: this._auditorStorage,
			actorExtractor: this._actorExtractor,
			audits: this._audits,
			databaseService: this._databaseService,
			rlsConfig: this._rlsConfig,
			rlsBypass: this._rlsBypass,
			responseType: this._responseType,
			responses: this._responses,
			...(this._telemetry ? { telemetry: this._telemetry } : {}),
			errors: mergeEndpointErrors(this._surface?.refusals, this._errors),
			...(this._responseHeaders
				? { responseHeaders: this._responseHeaders }
				: {}),
		});

		// One field says which process runs a construct, whatever its kind. An
		// endpoint's is its surface; a cron's is the worker that handed out the
		// factory. The build partitions on this rather than on directories.
		endpoint.owner = this._surface?.id;
		if (this._callbacks) endpoint.callbacks = this._callbacks;

		return endpoint;
	}
}

/**
 * A handler given an upload's signed form beside everything else: the
 * context `H` receives, with `upload`.
 */
export type UploadHandler<H extends (...args: any[]) => any> = (
	ctx: Parameters<H>[0] & { upload: UploadPost },
	response: Parameters<H>[1],
) => ReturnType<H>;

/**
 * What `.upload(bucket, …)` returns: the same builder, whose handler is also
 * given the signed form.
 */
export class UploadEndpointBuilder<
	TRoute extends string,
	TMethod extends HttpMethod,
	TInput extends EndpointSchemas = {},
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
	OutSchema extends StandardSchemaV1 | undefined = undefined,
	TSession = unknown,
	TAuthorizers extends readonly string[] = readonly string[],
	TAuditStorage extends AuditStorage | undefined = undefined,
	TAuditStorageServiceName extends string = string,
	TAuditAction extends AuditableAction<string, unknown> = AuditableAction<
		string,
		unknown
	>,
	TDatabase = undefined,
	TDatabaseServiceName extends string = string,
> extends EndpointBuilder<
	TRoute,
	TMethod,
	TInput,
	TServices,
	TLogger,
	OutSchema,
	TSession,
	TAuthorizers,
	TAuditStorage,
	TAuditStorageServiceName,
	TAuditAction,
	TDatabase,
	TDatabaseServiceName
> {
	/** The bucket's service, and what an upload to it allows. */
	_upload!: {
		serviceName: string;
		options: UploadOptions<any>;
	};

	override handle(
		fn: UploadHandler<
			EndpointHandler<
				TInput,
				TServices,
				TLogger,
				OutSchema,
				TSession,
				TDatabase,
				TAuditStorage,
				TAuditAction
			>
		>,
	): Endpoint<
		TRoute,
		TMethod,
		TInput,
		OutSchema,
		TServices,
		TLogger,
		TSession,
		TAuditStorage,
		TAuditStorageServiceName,
		TAuditAction,
		TDatabase,
		TDatabaseServiceName
	> {
		const { serviceName, options } = this._upload;

		// Issued once the request has been parsed and authorized — the key is
		// resolved from the body and the session — and before the handler runs.
		// Defined on the context rather than spread into a copy, so the lazy
		// accessors on it stay lazy.
		const handler = (async (ctx: any, response: any) => {
			const storage = ctx.services[serviceName] as StorageClient;
			const upload = await issueUpload(storage, ctx, options);
			Object.defineProperty(ctx, 'upload', {
				value: upload,
				enumerable: true,
			});
			return fn(ctx, response);
		}) as unknown as EndpointHandler<
			TInput,
			TServices,
			TLogger,
			OutSchema,
			TSession,
			TDatabase,
			TAuditStorage,
			TAuditAction
		>;

		return super.handle(handler);
	}
}
