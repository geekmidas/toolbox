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
	MobileAppDeclaration,
	Node,
	ObjectsDeclaration,
	OidcDeclaration,
	PostgresVersion,
	ProvidedKeys,
	Provides,
	ProvidesByKind,
	QueueDeclaration,
	RestApiDeclaration,
	RestApiEndpoint,
	SecretDeclaration,
	SiteDeclaration,
	TelemetryDeclaration,
	TelemetryKey,
	TopicDeclaration,
	WorkerDeclaration,
} from './declaration';
export {
	DEFAULT_POSTGRES_VERSION,
	DERIVES_FROM,
	PUBLIC,
	TELEMETRY_KEYS,
} from './declaration';
export {
	assertDerivations,
	dependenciesOf,
	dependentsOf,
	isDerived,
	PUBLIC_PREFIX,
	provisionOrder,
	publicEnvFor,
} from './derive';
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
	kebabCase,
	providedKeyFor,
	provideKey,
	scopedName,
	serviceKey,
} from './naming';

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
