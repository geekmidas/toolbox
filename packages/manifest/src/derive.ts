/**
 * Derived constructs — the ones that provision nothing of their own.
 *
 * A reader is an endpoint on an existing cluster; a schema tenant is a schema
 * inside an existing database. Both name their parent through `of`, and both
 * stay top-level entries so that `dependencies[].target` keeps resolving as
 * `m[target]` and every id remains a key in the map.
 *
 * The rules here are pure and manifest-only: they hold for any target adapter,
 * so an app is wrong before a deploy is attempted rather than during one.
 */

import type {
	ConstructId,
	ConstructManifest,
	Declaration,
	Dependency,
	DerivedDeclaration,
	SiteDeclaration,
} from './declaration';
import { DERIVES_FROM, PUBLIC } from './declaration';
import { IllegalDerivation, UnknownParent } from './errors';
import { provideKey } from './naming';

/** Whether a declaration names a parent. */
export function isDerived(
	declaration: Declaration,
): declaration is DerivedDeclaration & { of: ConstructId } {
	// Both halves, because one kind is *optionally* derived: a cache declared
	// from a database names it, and a cache declared on its own names nothing.
	// Testing only the kind would make every standalone cache look like a
	// derivation with a missing parent.
	return (
		declaration.kind in DERIVES_FROM &&
		'of' in declaration &&
		typeof declaration.of === 'string'
	);
}

/**
 * Check every derived construct against its parent.
 *
 * Two rules: the parent exists, and its kind may vend this one. Together they
 * make cycles unreachable — a reader is terminal, so no chain of `of` can
 * return to where it started, and no walk is needed to prove it.
 */
export function assertDerivations(manifest: ConstructManifest): void {
	for (const [id, declaration] of Object.entries(manifest)) {
		if (!isDerived(declaration)) continue;

		const parent = manifest[declaration.of];
		if (!parent) {
			throw new UnknownParent(id, declaration.of, Object.keys(manifest));
		}

		const allowed = DERIVES_FROM[declaration.kind];
		if (!allowed.includes(parent.kind)) {
			throw new IllegalDerivation(id, declaration.kind, parent.kind, allowed);
		}
	}
}

/**
 * The order constructs must be provisioned in: every parent before its children.
 *
 * Resources are leaves and so come first in any order; only derived nodes
 * constrain the sequence, and they form a shallow forest rather than a general
 * graph. This walks each node's ancestors on demand instead of running a full
 * topological sort, which is the same result at this depth and reads as what it
 * is.
 *
 * Assumes {@link assertDerivations} has passed — a missing parent would
 * otherwise be a silent omission here rather than an error.
 */
export function provisionOrder(manifest: ConstructManifest): string[] {
	const ordered: string[] = [];
	const placed = new Set<string>();

	const place = (id: string): void => {
		if (placed.has(id)) return;
		const declaration = manifest[id];
		if (!declaration) return;

		// Mark before recursing: `assertDerivations` rules cycles out, and marking
		// first means a manifest that skipped that check terminates anyway.
		placed.add(id);
		if (isDerived(declaration)) place(declaration.of);
		ordered.push(id);
	};

	for (const id of Object.keys(manifest)) place(id);

	return ordered;
}

/**
 * Every edge a declaration carries, wherever the kind happens to keep them.
 *
 * Dependencies live in two places by design: on a node when the whole construct
 * is the consumer (a site), and on each nested handler when the construct is a
 * surface (a `rest-api`, whose routes each depend on their own things and
 * nothing more). Flattening that difference here is what lets every consumer of
 * the graph — reverse lookups, filtering, reference checks — ask one question.
 */
export function dependenciesOf(
	declaration: Declaration,
): readonly Dependency[] {
	const own =
		'dependencies' in declaration ? (declaration.dependencies ?? []) : [];

	// A surface's `calls` is a caller relationship rather than an injection, so
	// it is read here — reverse lookups want it — and is never a dependency
	// anything links from. See `RestApiDeclaration.calls`.
	const calls = 'calls' in declaration ? (declaration.calls ?? []) : [];

	const nested =
		declaration.kind === 'rest-api'
			? declaration.endpoints.flatMap((endpoint) => endpoint.dependencies)
			: [];

	return [...own, ...calls, ...nested];
}

/**
 * The ids that depend on one construct — the graph read backwards.
 *
 * This is the whole mechanism behind CORS origins and trusted origins. Both are
 * lists of *callers*, and a caller is exactly an inbound edge, so neither is
 * ever written down: a surface that listed its own callers would have to be
 * edited every time something new called it, which is the hand-maintained list
 * this replaces.
 *
 * Sorted, because it feeds a comma-separated env value that would otherwise
 * change whenever the manifest's key order did — and a value that churns is a
 * container that redeploys for no reason.
 */
export function dependentsOf(
	manifest: ConstructManifest,
	id: ConstructId,
): string[] {
	const callers: string[] = [];

	for (const [callerId, declaration] of Object.entries(manifest)) {
		if (callerId === id) continue;
		if (dependenciesOf(declaration).some((edge) => edge.target === id)) {
			callers.push(callerId);
		}
	}

	return callers.sort();
}

/**
 * How each site variant names a value it ships to the browser.
 *
 * The prefix *is* the framework's contract — `VITE_`, `NEXT_PUBLIC_` and
 * `EXPO_PUBLIC_` all mean "inline this into the bundle" — so it is the one thing
 * a variant changes, and it changes nothing else.
 */
export const PUBLIC_PREFIX: Record<SiteDeclaration['variant'], string> = {
	static: 'VITE_',
	tanstack: 'VITE_',
	next: 'NEXT_PUBLIC_',
};

/**
 * The keys a site's bundle needs, mapped to the key each value comes from —
 * `{ VITE_API_URL: 'API_URL' }`.
 *
 * A rename, not a second derivation: `API_URL` is resolved once, by whatever
 * resolved it for the server, and the site reads the same value under the name
 * its bundler will inline. That is what keeps a site and its API from coming to
 * disagree about where the API is.
 *
 * Filtered by `PUBLIC` rather than by what the site asked for. A site may
 * legitimately depend on anything — its server half, where it has one, reads env
 * exactly as a function does — so this is not a restriction on edges. It decides
 * one thing: which values may be prefixed into a bundle, which is what keeps
 * `ORDERS_URL` and its password out of a JavaScript file served to the public.
 *
 * Shared by every target for the same reason `providedKeyFor` is: a site built
 * locally and the same site built by a deploy must inline the same names.
 */
export function publicEnvFor(
	declaration: SiteDeclaration,
	manifest: ConstructManifest,
): Record<string, string> {
	const prefix = PUBLIC_PREFIX[declaration.variant];
	const keys: Record<string, string> = {};

	for (const edge of declaration.dependencies) {
		const target = manifest[edge.target];
		if (!target) continue;

		for (const role of PUBLIC[target.kind] ?? []) {
			const key = provideKey(edge.target, role as string);
			keys[`${prefix}${key}`] = key;
		}
	}

	return keys;
}
