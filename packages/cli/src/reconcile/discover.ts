/**
 * Discovery — one glob, one structural test.
 *
 * A glob per kind is the same specialness the construct model removes, and
 * resources have no kind to be listed under: a declared `ObjectStorage` would
 * never be found by `routes:` or `crons:`. So there is one `constructs` glob,
 * every export of every matching module is inspected, and the per-kind
 * `isConstruct` checks collapse into a single question — does it have an id and
 * can it declare?
 *
 * Structural rather than `instanceof` on purpose. A construct from a different
 * copy of `@geekmidas/constructs` — a linked workspace, two versions in a
 * lockfile — is still a construct, and `instanceof` is exactly the check that
 * says otherwise.
 */

import { relative } from 'node:path';
import {
	assertDerivations,
	type ConstructManifest,
	canonicalId,
	type Declaration,
} from '@geekmidas/manifest';
import fg from 'fast-glob';
import { clearZodGlobalRegistry } from '../generators/Generator';

/** The construct face discovery needs: an id, and the ability to declare. */
interface Declarable {
	id: string;
	declare(): Declaration[];
}

/**
 * Whether a module export is a construct.
 *
 * Deliberately loose about what else it carries — a construct that also has a
 * `service` is still a construct, and requiring one would exclude the kinds that
 * own no address.
 */
export function isDeclarable(value: unknown): value is Declarable {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Partial<Declarable>;

	return (
		typeof candidate.id === 'string' &&
		candidate.id.length > 0 &&
		typeof candidate.declare === 'function'
	);
}

export interface DiscoverOptions {
	/** The glob(s) to search. One pattern, not one per kind. */
	patterns: string | readonly string[];
	cwd?: string;
	/**
	 * Re-import changed modules, for the dev watcher.
	 *
	 * A single glob makes discovery more central, not less: a new construct file
	 * has to be picked up on `add`, not only on `change`.
	 */
	bustCache?: boolean;
}

/**
 * Build the construct manifest for a project.
 *
 * Runs the manifest's own validation before returning, so an app is wrong here
 * — where the error names a file — rather than at deploy.
 *
 * @throws {DuplicateConstruct} when two exports claim one id.
 */
export async function discover(
	options: DiscoverOptions,
): Promise<ConstructManifest> {
	const { patterns, cwd = process.cwd(), bustCache = false } = options;

	// Re-importing user modules re-executes them, and Zod v4 throws on a
	// re-registered `.meta({ id })`. Same reason the generators clear it.
	if (bustCache) clearZodGlobalRegistry();

	const manifest: Record<string, Declaration> = {};
	/** Which file declared each id, for the error when two of them do. */
	const sources: Record<string, string> = {};
	/**
	 * Constructs already seen, by identity.
	 *
	 * A re-export is the *same object* reached through a second file — ESM
	 * bindings are live, so `export * from './database.js'` hands back the
	 * binding rather than a copy. Without this, a barrel file made every
	 * construct in it appear declared twice, and `constructs/index.ts` is the
	 * first thing anyone writes in a shared folder.
	 *
	 * Identity rather than file is also the more honest rule: what may not
	 * happen twice is two *different* constructs claiming one id, and that is
	 * still an error below.
	 */
	const seen = new WeakSet<object>();

	const files = fg.stream(
		Array.isArray(patterns) ? [...patterns] : [patterns as string],
		{ cwd, absolute: true },
	);

	for await (const found of files) {
		const file = found.toString();
		const module = await import(bustCache ? `${file}?t=${Date.now()}` : file);

		for (const exported of Object.values(module)) {
			if (!isDeclarable(exported)) continue;

			// The same construct, reached again through a re-export. Skipped
			// rather than re-declared: it has already claimed its id, from the
			// file that defined it.
			if (seen.has(exported as object)) continue;
			seen.add(exported as object);

			for (const declaration of exported.declare()) {
				// Canonicalise here too: a construct built by hand rather than through
				// a constructor is still subject to the same identity rule.
				const id = canonicalId(declaration.id);
				const source = relative(cwd, file);

				const claimed = sources[id];
				if (claimed !== undefined && claimed !== source) {
					throw new DuplicateConstruct(id, [claimed, source]);
				}

				manifest[id] = { ...declaration, id };
				sources[id] = source;
			}
		}
	}

	// Reference integrity before anyone reads it — a schema tenant naming a
	// database that was deleted is a manifest error, not a reconcile failure.
	assertDerivations(manifest);

	return manifest;
}

/** Two constructs claiming one id. */
export class DuplicateConstruct extends Error {
	/** The id claimed twice. */
	readonly id: string;
	/** The files that claimed it. */
	readonly sources: readonly string[];

	constructor(id: string, sources: readonly string[]) {
		super('Two constructs declare the same id');
		this.name = 'DuplicateConstruct';
		this.id = id;
		this.sources = sources;
	}
}
