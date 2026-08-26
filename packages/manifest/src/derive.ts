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
} from './declaration';
import { DERIVES_FROM } from './declaration';
import { IllegalDerivation, UnknownParent } from './errors';

/** Whether a declaration names a parent. */
export function isDerived(
	declaration: Declaration,
): declaration is DerivedDeclaration {
	return declaration.kind in DERIVES_FROM;
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
	const own = 'dependencies' in declaration ? declaration.dependencies : [];
	const nested =
		declaration.kind === 'rest-api'
			? declaration.endpoints.flatMap((endpoint) => endpoint.dependencies)
			: [];

	return [...own, ...nested];
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
