/**
 * Type-level tests for open paths.
 *
 * The runtime check is in `file-server.spec.ts`; these are the half that has to
 * fail at compile time, because "you cannot hand out an unsigned URL for a
 * private object" is only a guarantee if the wrong call does not build.
 *
 * Type-checked, never executed — `*.spec.ts` is excluded from the project
 * tsconfig and this is not, which is what makes a broken assertion here a
 * failing `tsc`.
 */

import type { FileServerClient, Served } from '../file-server';

type Expect<T extends true> = T;
type Equals<A, B> =
	(<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
		? true
		: false;

// ---------------------------------------------------------------------------
// The pattern type
// ---------------------------------------------------------------------------

/** A double star admits anything under the prefix, `/` included. */
type _Deep = Expect<Equals<Served<'brand/**'>, `brand/${string}`>>;

/**
 * A single star admits the same thing, which is the limit worth stating: a
 * template literal cannot exclude `/`, so the *exact* pattern is enforced at
 * runtime and by the infrastructure, and the type is a prefix-and-suffix guard.
 */
type _Wide = Expect<Equals<Served<'avatars/*.png'>, `avatars/${string}.png`>>;

/** A literal pattern admits itself and nothing else. */
type _Exact = Expect<Equals<Served<'robots.txt'>, 'robots.txt'>>;

// ---------------------------------------------------------------------------
// The call site
// ---------------------------------------------------------------------------

declare const files: FileServerClient<'brand/**' | 'avatars/*.png'>;

files.url('brand/logo.png');
files.url('brand/dark/logo.png');
files.url(`avatars/${'id' as string}.png`);

// @ts-expect-error — never served unsigned, so this must not build.
files.url('invoices/7.pdf');

// @ts-expect-error — a fully dynamic key cannot be checked, and `openUrl` is
// the escape hatch rather than a cast.
files.url('key' as string);

// The escape hatch takes it, and runs the same runtime check.
files.openUrl('key' as string);

// Signing is not restricted: the asymmetry worth enforcing is the unsigned URL.
files.signedUrl('invoices/7.pdf');

/** A server with no open paths can serve nothing unsigned, by type. */
declare const shut: FileServerClient;

// @ts-expect-error — `never` admits no key at all.
shut.url('anything');
