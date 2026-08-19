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
 * Every declaration. A discriminated union, so `kind` gives exhaustiveness *and*
 * per-kind fields — there is no separate enum to keep in step, and no shape
 * carrying fields that belong to a different kind.
 */
export type Declaration =
	| ObjectsDeclaration
	| EmailDeclaration
	| DatabaseDeclaration
	| DatabaseReaderDeclaration
	| DatabaseSchemaDeclaration;

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
};
