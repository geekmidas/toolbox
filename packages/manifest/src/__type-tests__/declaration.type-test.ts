/**
 * Type-level tests for selecting out of a concrete manifest.
 *
 * The point of `as const satisfies ConstructManifest` is that ids, kinds, and
 * provided keys stay literal. Annotating with the type instead would widen them
 * to `string` and every assertion below would fail — which is what makes these
 * worth having: they fail if someone "tidies up" the generated manifest.
 */

import type {
	AllProvidedKeys,
	ConstructManifest,
	DeclarationOf,
	IdsOf,
	IdsOfKind,
	ProvidedKeys,
} from '../declaration';

const manifest = {
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
	Avatars: {
		kind: 'objects',
		id: 'Avatars',
		provides: ['AVATARS_URL'],
		versioned: true,
	},
} as const satisfies ConstructManifest;

type M = typeof manifest;

type Expect<T extends true> = T;
type Equals<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

// Ids are the literal keys, not `string`.
type _Ids = Expect<Equals<IdsOf<M>, 'Uploads' | 'Avatars'>>;

// Selecting one construct keeps its literal shape.
type _Kind = Expect<Equals<DeclarationOf<M, 'Uploads'>['kind'], 'objects'>>;
type _Versioned = Expect<
	Equals<DeclarationOf<M, 'Avatars'>['versioned'], true>
>;

// Provided keys are literals, so an adapter can type the env it composes.
type _Provided = Expect<Equals<ProvidedKeys<M, 'Uploads'>, 'UPLOADS_URL'>>;
type _AllProvided = Expect<
	Equals<AllProvidedKeys<M>, 'UPLOADS_URL' | 'AVATARS_URL'>
>;

// Iterating a kind yields only the ids of that kind.
type _OfKind = Expect<Equals<IdsOfKind<M, 'objects'>, 'Uploads' | 'Avatars'>>;

// An id that is not in the manifest is not selectable.
// @ts-expect-error - 'Missing' is not an id of this manifest
type _Unknown = DeclarationOf<M, 'Missing'>;

// The shape is still checked: a kind that does not exist is rejected.
const _badKind = {
	// @ts-expect-error - 'buckets' is not a DeclarationKind
	Nope: { kind: 'buckets', id: 'Nope' },
} as const satisfies ConstructManifest;
