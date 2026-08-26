/**
 * The construct manifest — the contract between what an application declares
 * and what a target adapter provisions.
 *
 * Kinds are added here as each one lands, not up front: a declaration for a
 * construct nobody has built yet is a guess that the implementation will
 * contradict. See `docs/design/constructs-paradigm.md`.
 */

/**
 * A construct's canonical id — PascalCase, unique within the manifest.
 *
 * Inputs canonicalise, so `uploads`, `Uploads`, `user_uploads`, and
 * `user-uploads` are the *same* id rather than four that collide. Everything
 * else derives from it: the service key is its `Uncapitalize`, the env prefix
 * its SCREAMING_SNAKE form, the cloud name its kebab form scoped by stage and
 * app.
 */
export type ConstructId = string;

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/**
 * Constrains a construct name at the point it is written.
 *
 * Resolves to the name itself when valid, and otherwise to a string explaining
 * why — so the compiler reports *"not assignable to type 'a construct name
 * cannot start with a digit'"* rather than the unhelpful `never`.
 *
 * Only the cases a template-literal type can see are caught here; `canonicalId`
 * enforces the rest at runtime, which is also what covers JavaScript callers.
 *
 * @example new ObjectStorage('Uploads')  // ok
 * @example new ObjectStorage('2fa')      // a construct name cannot start with a digit
 */
export type ConstructName<S extends string> = S extends ''
	? 'a construct name cannot be empty'
	: S extends `${Digit}${string}`
		? 'a construct name cannot start with a digit'
		: S;

/** Shared by every declaration. */
export interface Node {
	id: ConstructId;
	/**
	 * Env keys this construct resolves onto anything that depends on it.
	 * Names only — the values are composed by the adapter from the provisioned
	 * resource's own attributes.
	 */
	provides?: readonly string[];
	/**
	 * Env keys this construct needs. Derivable from `dependencies`, so it is an
	 * assertion rather than an input: the adapter composes env from the edges and
	 * checks the result against this, which catches app/infra drift at synth.
	 */
	requires?: readonly string[];
}

/**
 * A dependency edge. Records only *what* is depended on — never permissions.
 * From one edge the framework derives env and the runtime binding; a target
 * adapter separately derives cloud access.
 */
export interface Dependency<TTarget extends ConstructId = ConstructId> {
	/**
	 * The {@link ConstructId} of the consumed construct. Left open here because a
	 * declaration is written before the manifest that contains it; once assembled,
	 * `IdsOf` narrows it and the build's reference-integrity check enforces it.
	 */
	target: TTarget;
	kind: DeclarationKind;
}

/** Anything with a handler. */
export interface Fn extends Node {
	handler: string;
	dependencies: readonly Dependency[];
}

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

/** Blob storage. `--target=aws` provisions a bucket. */
export interface ObjectsDeclaration extends Node {
	kind: 'objects';
	versioned?: boolean;
}

/**
 * Outbound email.
 *
 * Provides one `smtp://` URL and nothing else, because email is delivered over
 * SMTP whatever the provider — Mailpit locally, SES through its SMTP interface,
 * Resend and Postmark through theirs. There is no `provider` field here for the
 * same reason there is no `ses://` scheme: which service delivers the mail
 * differs between dev and prod, so by this design's own test it is stage-varying
 * config rather than a structural fact about the app.
 *
 * What *is* structural is only that the app sends mail at all. The sending
 * domain is not: it is `myapp.test` locally and `example.com` deployed, so it
 * fails the same test the provider does and resolves at deploy alongside every
 * other address.
 */
export interface EmailDeclaration extends Node {
	kind: 'email';
}

/**
 * A logical database, its schema, and the roles that reach it.
 *
 * Provides one key — the *runtime* role's URL. The owner URL exists but is
 * deliberately absent from `provides`: it is wired by the adapter straight into
 * the migrator and seeder this construct declares, so no edge in any manifest
 * can name it and nothing else can be granted it by mistake.
 */
export interface DatabaseDeclaration extends Node {
	kind: 'database';
	engine?: 'postgres';
	/**
	 * The schema, pinned on both roles' `search_path`. Names the role the schema
	 * plays rather than restating the database's own name, so `app` reads
	 * correctly beside `auth` and `pgboss`.
	 */
	schema?: string;
	/**
	 * Whether to provision the owner/runtime role split. Off falls back to the
	 * cluster's master credential in both URLs — a deliberate downgrade, not a
	 * default. See `roles: false` in the design doc.
	 */
	roles?: boolean;
}

/**
 * A read-only endpoint on an existing database or schema.
 *
 * Provisions no cluster of its own — `of` names the parent it reads from.
 * Read-only is enforced by the role's grants rather than by which endpoint it
 * resolves to, so falling back to the writer where no replica exists stays safe.
 */
export interface DatabaseReaderDeclaration extends Node {
	kind: 'database-reader';
	of: ConstructId;
}

/**
 * A second schema inside an existing database, with its own role(s) and URL.
 *
 * The mechanism behind tenancy: the parent's role holds no grant on these
 * tables at all. pg-boss is an instance of this rather than a special case.
 */
export interface DatabaseSchemaDeclaration extends Node {
	kind: 'database-schema';
	of: ConstructId;
	schema: string;
}

/**
 * A generated secret — a signing key, a token, anything with no address.
 *
 * It provides a value rather than a URL, which is why it is a node of its own
 * instead of a field on whatever needs it: the thing that generates it, the
 * thing that stores it, and the thing that reads it are three different systems
 * deployed, and one derived string locally.
 */
export interface SecretDeclaration extends Node {
	kind: 'secret';
}

/**
 * A key/value cache.
 *
 * Provides one URL carrying its own token, because a cache is reached over the
 * same protocol wherever it runs — Upstash's REST API deployed, and a proxy in
 * front of Redis locally, which is what lets the client be identical in both.
 * Nothing here says Redis: what backs it is the provider's business.
 */
export interface CacheDeclaration extends Node {
	kind: 'cache';
}

/**
 * An HTTP surface and the handlers mounted on it.
 *
 * The first kind that is not a resource in the ordinary sense: it owns an
 * address, and the functions it triggers are *nested inside it* rather than
 * listed beside it, because position carries the trigger — a handler here is
 * reached by its method and path and by nothing else.
 *
 * `authorizers` are names. A bare string is resolved by the target (`iam`), while
 * a {@link ConstructId} names a construct that carries its own implementation,
 * its database dependency, and its session typing.
 */
export interface RestApiDeclaration extends Node {
	kind: 'rest-api';
	authorizers?: readonly string[];
	/** The authorizer applied where an endpoint names none. */
	defaultAuthorizer?: string;
	/**
	 * The routes known when the surface declared itself.
	 *
	 * Empty is ordinary rather than wrong. A surface whose routes are a known,
	 * fixed set enumerates them here — an auth server's single wildcard is the
	 * case — while an application's own API spreads its routes over a tree of
	 * modules that the declaring construct cannot import without becoming a
	 * bundler. That surface names {@link RestApiDeclaration.routes} instead and
	 * the build fills this in, which is the same split the design draws
	 * everywhere else: what is structural is declared, what has to be found is
	 * found once, by the thing that already walks the filesystem.
	 */
	endpoints: readonly RestApiEndpoint[];
	/**
	 * Where to find the routes this surface mounts, as globs relative to the app
	 * root. Present when `endpoints` is discovered rather than enumerated.
	 */
	routes?: readonly string[];
	/**
	 * What the surface itself calls, as opposed to what its routes call.
	 *
	 * The distinction is real and small: an API sitting in front of a separate
	 * auth server calls it from every route, and that is what puts this API's
	 * origin on that server's trusted list. Per-route edges live on the
	 * endpoints, and both are read together — nothing has to know which of the
	 * two places an edge came from.
	 */
	dependencies?: readonly Dependency[];
}

/**
 * A frontend — a construct like any other, which is what removes the last
 * mechanism that ran in parallel to the graph.
 *
 * Its edges are what make it worth declaring. A site depending on an API is the
 * single fact behind four things that are hand-maintained otherwise: the site's
 * build-time `VITE_API_URL`, the API's CORS origins, the auth server's trusted
 * origins, and which generated client lands in which app. None of those are
 * declared anywhere here, because all four are the *same* edge read from one
 * end or the other.
 *
 * `variant` is the framework, because the framework changes the code you write:
 * it selects how the values are delivered (`VITE_`, `NEXT_PUBLIC_`, a
 * `config.json`), never which values there are.
 */
export interface SiteDeclaration extends Node {
	kind: 'site';
	variant: 'static' | 'next' | 'tanstack';
	/** Where its source lives, relative to the workspace root. */
	path: string;
	/**
	 * What it calls. On a node rather than on a handler because a site has no
	 * single entrypoint — the whole app is the consumer.
	 */
	dependencies: readonly Dependency[];
}

/** One route on a surface. */
export interface RestApiEndpoint extends Fn {
	method: string;
	path: string;
	authorizer?: string;
}

/**
 * A point-to-point queue and the single consumer that drains it.
 *
 * Provides one key, the producer's connection string. The protocol in it picks
 * the transport — `pgboss://` locally, `sqs://` deployed — so a producer names
 * no broker, exactly as a database consumer names no cloud.
 *
 * The consumer side provides nothing: a worker is reached *through* its queue,
 * so there is no second key and nothing can depend on a handler.
 */
export interface QueueDeclaration extends Node {
	kind: 'queue';
	/** FIFO ordering, where the transport offers it. */
	fifo?: boolean;
}

/**
 * A topic — pub/sub fan-out, one publisher and any number of subscribers.
 *
 * Like a queue it provides only the producer's string; a subscriber is bound to
 * the topic rather than depending on it, so the binding is an edge the deploy
 * target reads, not an env key. Locally both sides meet on the same pg-boss
 * connection, which is why the subscriber needs no key of its own.
 */
export interface TopicDeclaration extends Node {
	kind: 'topic';
}

/**
 * Every declaration. A discriminated union, so `kind` gives exhaustiveness *and*
 * per-kind fields — there is no separate enum to keep in step, and no shape
 * carrying fields that belong to a different kind.
 */
export type Declaration =
	| ObjectsDeclaration
	| EmailDeclaration
	| DatabaseDeclaration
	| DatabaseReaderDeclaration
	| DatabaseSchemaDeclaration
	| CacheDeclaration
	| SecretDeclaration
	| RestApiDeclaration
	| SiteDeclaration
	| QueueDeclaration
	| TopicDeclaration;

/** A declaration that provisions nothing of its own and names a parent. */
export type DerivedDeclaration = Extract<Declaration, { of: ConstructId }>;

export type DerivedKind = DerivedDeclaration['kind'];

/**
 * What each kind may derive from.
 *
 * Small enough to state exhaustively, and stating it makes cycles impossible
 * without a graph walk: readers are terminal, so no chain can return to its
 * start. There is no `writer` — the database *is* the writer, which is what
 * keeps a replica from being reached by accident.
 */
export const DERIVES_FROM: Readonly<Record<DerivedKind, readonly string[]>> = {
	'database-reader': ['database', 'database-schema'],
	'database-schema': ['database'],
};

export type DeclarationKind = Declaration['kind'];

/**
 * The manifest: every construct keyed by its id.
 *
 * Flat rather than grouped, because `Dependency.target` resolves as
 * `m[target]` — a lookup that stays O(1) and identical whether the edge points
 * at a resource, a surface, or another function.
 *
 * Use it as a **constraint, not an annotation**. `gkm build` emits
 * `as const satisfies ConstructManifest`, which checks the shape while keeping
 * every id, kind, and provided key a literal — annotating with this type
 * instead would widen them all to `string` and consumers could no longer select
 * anything:
 *
 * ```ts
 * export const manifest = {
 *   Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
 * } as const satisfies ConstructManifest;
 *
 * type Ids = IdsOf<typeof manifest>;                       // 'Uploads'
 * type Env = ProvidedKeys<typeof manifest, 'Uploads'>;     // 'UPLOADS_URL'
 * ```
 */
export type ConstructManifest = Readonly<Record<ConstructId, Declaration>>;

// ---------------------------------------------------------------------------
// Selecting from a concrete manifest
// ---------------------------------------------------------------------------

/** Every id in a manifest. */
export type IdsOf<M extends ConstructManifest> = Extract<keyof M, string>;

/** The declaration for one id. */
export type DeclarationOf<
	M extends ConstructManifest,
	K extends IdsOf<M>,
> = M[K];

/** Every id of a given kind — what an adapter iterates when provisioning. */
export type IdsOfKind<
	M extends ConstructManifest,
	K extends DeclarationKind,
> = {
	[Id in IdsOf<M>]: M[Id]['kind'] extends K ? Id : never;
}[IdsOf<M>];

/** The env keys one construct provides. */
export type ProvidedKeys<
	M extends ConstructManifest,
	K extends IdsOf<M>,
> = M[K] extends { provides: readonly (infer P)[] } ? P : never;

/** Every env key any construct in the manifest provides. */
export type AllProvidedKeys<M extends ConstructManifest> = {
	[Id in IdsOf<M>]: ProvidedKeys<M, Id>;
}[IdsOf<M>];

// ---------------------------------------------------------------------------
// The app ↔ infra contract
// ---------------------------------------------------------------------------

/**
 * What each kind provides, by role rather than by provider syntax.
 *
 * This is the contract between the construct that declares a key and the cloud
 * component that supplies its value — an interface rather than shared code,
 * because a shared codec would have to contain `bucket` and `region`, and
 * provider words in the neutral layer is the problem this design exists to fix.
 *
 * How a value is composed and parsed stays private to each provider pair, so
 * `s3://` and `gs://` never appear here.
 */
export interface ProvidesByKind {
	objects: { url: string };
	/** An `smtp://` URL, credentials included — never shippable. */
	email: { url: string };
	/**
	 * One key, the runtime role's. The owner URL is not here by design — see
	 * {@link DatabaseDeclaration}.
	 */
	database: { url: string };
	'database-reader': { url: string };
	'database-schema': { url: string };
	/** The endpoint and its token, in one string. */
	cache: { url: string };
	/**
	 * Where the surface answers, who may call it, and the domain its cookies
	 * are scoped to.
	 *
	 * Only `url` is a fact about the surface itself. The other two are read off
	 * its *inbound* edges — every construct that depends on it — which is why a
	 * surface never lists its own callers: nothing enumerates the things that
	 * point at it, the graph already does.
	 *
	 * `trustedOrigins` and `cookieDomain` are one key each rather than a list
	 * and a structure, because both cross a process boundary as environment.
	 */
	'rest-api': {
		url: string;
		/** Comma-separated. Empty when nothing declares an edge to this surface. */
		trustedOrigins: string;
		/**
		 * The parent domain shared by the surface and its callers, leading dot
		 * included — `.example.com`. Absent where there is nothing to share:
		 * one host locally, unrelated hosts deployed.
		 */
		cookieDomain: string;
	};
	/** The value itself. A secret has no address to hand out instead. */
	secret: { value: string };
	/**
	 * The producer's connection string. One key, not two: the consumer is
	 * reached through the queue rather than by an address of its own.
	 */
	queue: { publisherConnectionString: string };
	topic: { publisherConnectionString: string };
	/** Where the site is served. Public for the same reason an API's is. */
	site: { url: string };
}

export type Provides<K extends keyof ProvidesByKind> = ProvidesByKind[K];

/**
 * Which provided values may be shipped to a browser.
 *
 * Drives client-side prefixing (`VITE_`, `NEXT_PUBLIC_`) and nothing else — it
 * is not a restriction on what may be depended on, since a server-side consumer
 * can legitimately use any of them. A bucket's `url` presigns and stays private.
 */
export const PUBLIC: {
	readonly [K in keyof ProvidesByKind]: readonly (keyof ProvidesByKind[K])[];
} = {
	objects: [],
	// Carries the SMTP credentials in its userinfo.
	email: [],
	// A connection string is never shippable, whichever role it carries.
	database: [],
	'database-reader': [],
	'database-schema': [],
	// Carries its token, and a cache a browser can write is a cache it can
	// poison.
	cache: [],
	// The whole point of one.
	secret: [],
	// A URL a browser calls is a URL a browser may hold. The other two are not
	// secret either — they are simply server-side facts, and prefixing a value
	// into a bundle that nothing there reads is how a bundle grows keys nobody
	// can account for.
	'rest-api': ['url'],
	// Carries broker credentials, and a browser that can publish to a queue can
	// forge any job the worker trusts.
	queue: [],
	topic: [],
	// Its own address, which it needs in order to build absolute links to
	// itself — and which an email templating a link to it needs too.
	site: ['url'],
};
