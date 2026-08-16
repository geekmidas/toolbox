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
 * Every declaration. A discriminated union, so `kind` gives exhaustiveness *and*
 * per-kind fields — there is no separate enum to keep in step, and no shape
 * carrying fields that belong to a different kind.
 */
export type Declaration = ObjectsDeclaration;

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
};
