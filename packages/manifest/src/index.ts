/**
 * The construct manifest — every construct the application declares, keyed by
 * id, with its dependency edges — is the shape `gkm build` writes to
 * `.gkm/manifest/<target>.ts` and `@geekmidas/cloud/sst` provisions from:
 *
 * ```ts
 * export const constructs = { … } as const satisfies ConstructManifest;
 * export const backends = { … } as const;
 * ```
 *
 * The `*Info` types below are what the build generates per handler before it
 * folds them into the declarations they belong to — a route into its surface,
 * a queue's worker into its queue.
 */

export type {
	AllProvidedKeys,
	AppSpec,
	CacheDeclaration,
	ConstructId,
	ConstructManifest,
	ConstructName,
	CredentialDeclaration,
	CronDeclaration,
	DatabaseDeclaration,
	DatabaseReaderDeclaration,
	DatabaseSchemaDeclaration,
	Declaration,
	DeclarationKind,
	DeclarationOf,
	Dependency,
	DerivedDeclaration,
	DerivedKind,
	EmailDeclaration,
	EncryptionDeclaration,
	ExternalApiDeclaration,
	FileServerDeclaration,
	Fn,
	FunctionDeclaration,
	Glob,
	IdsOf,
	IdsOfKind,
	InboxDeclaration,
	MobileAppDeclaration,
	MobileAppStage,
	Node,
	ObjectSubscriberDeclaration,
	ObjectsDeclaration,
	OidcDeclaration,
	PlayReleaseStatus,
	PlayTrack,
	PostgresVersion,
	ProcessorDeclaration,
	ProvidedKeys,
	Provides,
	ProvidesByKind,
	PublicDeclaration,
	QueueDeclaration,
	RestApiDeclaration,
	RestApiEndpoint,
	SecretDeclaration,
	SiteDeclaration,
	SiteHosts,
	SitePassword,
	TelemetryDeclaration,
	TelemetryKey,
	TopicDeclaration,
	WebSocketApiDeclaration,
	WebSocketEdgeLimits,
	WebSocketRouteDeclaration,
	WorkerDeclaration,
} from './declaration';
export {
	DEFAULT_POSTGRES_VERSION,
	DERIVES_FROM,
	isPublicDeclaration,
	isWildcardSite,
	PUBLIC,
	TELEMETRY_KEYS,
	WILDCARD_SUBDOMAIN,
} from './declaration';
export {
	assertDerivations,
	dependenciesOf,
	dependentsOf,
	IMAGE_ORIGINS_KEY,
	imageOriginSources,
	imageOrigins,
	isDerived,
	PUBLIC_PREFIX,
	type PublicValue,
	provisionOrder,
	publicEnvFor,
	publicValues,
} from './derive';
export {
	bucketExpiry,
	DEFAULT_DERIVED_DAYS,
	DERIVED_PREFIX,
} from './derived';
export { KMS_SCHEME, kmsUrl } from './encryption';
export {
	IllegalDerivation,
	InvalidConstructId,
	UnknownParent,
} from './errors';
export {
	DEFAULT_STAGE_URL,
	externalApiUrl,
	NoUrlForStage,
} from './external';
export {
	CLIENT_IP_HEADER,
	EDGE_TOKEN_HEADER,
	EDGE_TOKEN_KEY,
} from './headers';
export {
	assertHostLabels,
	type HostedDeclaration,
	HostLabelBothAliasAndRedirect,
	type HostLabelSource,
	type HostLabels,
	hostLabels,
	InvalidHostLabel,
	isHostedDeclaration,
	WildcardSiteCannotHaveAliases,
} from './hosts';
export {
	INBOX_EVENT,
	INBOX_MESSAGES_PREFIX,
	type InboxAddressing,
	type InboxRecipient,
	inboxRecipient,
	receiptRecipients,
} from './inbox';
export {
	DATABASE_FOLDERS,
	databaseFolder,
	MIGRATIONS_ROOT,
	type MigrationTarget,
	migrationFolder,
	migrationTargets,
	seedFolder,
} from './migrations';
export {
	isWebOrigin,
	type MetroHost,
	mobileOrigins,
	schemeBase,
} from './mobile';
export {
	cacheTable,
	canonicalId,
	cloudName,
	cookieDomain,
	environmentCase,
	FILE_SERVER_SUFFIX,
	fileServerName,
	fileServerSurfaceId,
	kebabCase,
	providedKeyFor,
	scopedName,
	serviceKey,
} from './naming';
export { trustsOrigin, wildcardDomainOf } from './origins';
export {
	drawSecret,
	SECRET_LENGTH,
	SECRET_SYMBOLS,
	type SecretFormat,
} from './secret';
export {
	API_GATEWAY_WEBSOCKET_SCHEME,
	type ApiGatewayWebSocketTarget,
	apiGatewayWebSocketUrl,
	InvalidApiGatewayWebSocketUrl,
	parseApiGatewayWebSocketUrl,
} from './websocket';

/** A single HTTP route. */
export interface RouteInfo {
	/** Route path, e.g. `/users/{id}`. */
	path: string;
	/** HTTP method, e.g. `GET`. */
	method: string;
	/** Bundled handler entrypoint. */
	handler: string;
	timeout?: number;
	memorySize?: number;
	/** Required environment variables (a trailing `?` marks an optional var). */
	environment?: readonly string[];
	/**
	 * The constructs this handler declared an edge to, by id.
	 *
	 * What `.dependsOn()` was given, carried through the build so the manifest
	 * records the edge rather than only its shadow. `environment` is that shadow —
	 * the keys the handler reads — and it cannot be turned back into edges, which
	 * is why both exist and only this one grants anything.
	 */
	dependencies?: readonly string[];
	/** Authorizer name: `none`, `iam`, or a declared authorizer. */
	authorizer: string;
}

/**
 * One route of a WebSocket surface, as a build for AWS generated it: the
 * Lambda API Gateway invokes for that route key.
 */
export interface WebSocketRouteInfo {
	/** The surface it belongs to. */
	surface: string;
	/** Its route key — an action, `$connect`, `$disconnect` or `$default`. */
	action: string;
	/** Bundled handler entrypoint. */
	handler: string;
}

/** A standalone Lambda function. */
export interface FunctionInfo {
	name: string;
	handler: string;
	timeout?: number;
	memorySize?: number;
	environment?: readonly string[];
	/**
	 * The constructs this handler declared an edge to, by id.
	 *
	 * What `.dependsOn()` was given, carried through the build so the manifest
	 * records the edge rather than only its shadow. `environment` is that shadow —
	 * the keys the handler reads — and it cannot be turned back into edges, which
	 * is why both exist and only this one grants anything.
	 */
	dependencies?: readonly string[];
}

/** A scheduled (cron) function. */
export interface CronInfo {
	name: string;
	handler: string;
	/** Schedule expression, e.g. `rate(1 day)` or `cron(0 12 * * ? *)`. */
	schedule: string;
	timeout?: number;
	memorySize?: number;
	environment?: readonly string[];
	/**
	 * The constructs this handler declared an edge to, by id.
	 *
	 * What `.dependsOn()` was given, carried through the build so the manifest
	 * records the edge rather than only its shadow. `environment` is that shadow —
	 * the keys the handler reads — and it cannot be turned back into edges, which
	 * is why both exist and only this one grants anything.
	 */
	dependencies?: readonly string[];
}

/** An event subscriber function (topic/queue resolved by `transport`). */
export interface SubscriberInfo {
	name: string;
	handler: string;
	subscribedEvents: readonly string[];
	/** Delivery transport — `topic` (SNS fan-out) or `queue` (SQS). */
	transport?: 'topic' | 'queue';
	/** The {@link TopicInfo.name} this subscriber binds to (via `worker.topic(topic)`). */
	topic?: string;
	/**
	 * The bucket this subscriber is bound to (via `worker.objects(bucket)`), by
	 * id — and which of its keys it watches.
	 */
	bucket?: string;
	prefix?: string;
	suffix?: string;
	/**
	 * The inbox this subscriber is bound to (via `worker.inbox(inbox)`), by id.
	 * It is delivered on the inbox's topic, from what the provider publishes —
	 * a receipt notification, not an event this toolbox wrote.
	 */
	inbox?: string;
	timeout?: number;
	memorySize?: number;
	environment?: readonly string[];
	/**
	 * The constructs this handler declared an edge to, by id.
	 *
	 * What `.dependsOn()` was given, carried through the build so the manifest
	 * records the edge rather than only its shadow. `environment` is that shadow —
	 * the keys the handler reads — and it cannot be turned back into edges, which
	 * is why both exist and only this one grants anything.
	 */
	dependencies?: readonly string[];
}

/**
 * A pub/sub topic — fan-out. A *resource* (no handler): it declares the event
 * contract; producers publish via the derived publisher and {@link SubscriberInfo}s
 * bind to it. Infra provisions an SNS topic.
 */
export interface TopicInfo {
	name: string;
	/** The event type names this topic carries. */
	events: readonly string[];
	/** Whether the topic is FIFO. */
	fifo?: boolean;
}

/** A file server's processor, as the build generated it. */
export interface ProcessorInfo {
	/** Its export. */
	name: string;
	handler: string;
	/** The file server's surface it answers on, by id. */
	fileServer: string;
	path: string;
	prefix: string;
	native?: readonly string[];
	timeout?: number;
	memorySize?: number;
	environment?: readonly string[];
	/** See {@link RouteInfo.dependencies} — same field, same reason. */
	dependencies?: readonly string[];
}

/** A queue worker — a queue and its single consumer. */
export interface QueueInfo {
	name: string;
	handler: string;
	/** SQS event-source batch size. */
	batchSize?: number;
	/** Whether the queue is FIFO. */
	fifo?: boolean;
	timeout?: number;
	memorySize?: number;
	environment?: readonly string[];
	/**
	 * The constructs the worker declared an edge to, by id.
	 *
	 * See {@link RouteInfo.dependencies} — same field, same reason.
	 */
	dependencies?: readonly string[];
}
