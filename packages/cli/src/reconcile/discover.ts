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

/** Matches the rest of the CLI, which logs through `console` directly. */
const logger = console;

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
	/**
	 * Filled in with where each construct was found, when provided.
	 *
	 * Discovery is the only thing that knows: it globbed the files and imported
	 * them. Everything downstream that needs to *write* an import — the build,
	 * generating a server entry that reads a surface's logger — would otherwise
	 * have to be told the path in config, which is the string this removes.
	 *
	 * An out-parameter rather than a second return value so that every existing
	 * caller, which wants the manifest and nothing else, is unchanged.
	 */
	sources?: Record<string, ConstructSource>;
}

/** Where a construct was declared, and under what name. */
export interface ConstructSource {
	/** Absolute path to the module that exported it. */
	file: string;
	/** The name it was exported as — what an import statement has to say. */
	exportName: string;
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
	const {
		patterns,
		cwd = process.cwd(),
		bustCache = false,
		sources: out,
	} = options;

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

	const globs = Array.isArray(patterns) ? [...patterns] : [patterns as string];
	const files = fg.stream(globs, { cwd, absolute: true });

	/** Matched files, for the diagnostic below. */
	let matched = 0;

	for await (const found of files) {
		matched++;
		const file = found.toString();
		const module = await import(bustCache ? `${file}?t=${Date.now()}` : file);

		for (const [exportName, exported] of Object.entries(module)) {
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
				if (out) out[id] = { file, exportName };
			}
		}
	}

	// Reference integrity before anyone reads it — a schema tenant naming a
	// database that was deleted is a manifest error, not a reconcile failure.
	assertDerivations(manifest);

	warnIfNothingFound(globs, matched, Object.keys(manifest).length);

	return manifest;
}

/**
 * Say so when a glob was configured and found nothing.
 *
 * The glob is not a filter over declarations already known — it is *how they
 * are found*, by importing what it matches. So a file it misses is a
 * declaration that does not exist, and every symptom of that appears somewhere
 * other than the cause: no container starts, no env key is written, and the
 * application fails on first use against a resource it can see in its own
 * source.
 *
 * Nothing reported it before, because an unmatched file is indistinguishable
 * from a file nobody wrote. These two cases are the ones that are *not*
 * ambiguous — a glob was configured, so something was expected.
 *
 * Silent when no glob is configured at all: that is a project which has not
 * adopted constructs, and has nothing to be missing.
 */
function warnIfNothingFound(
	globs: readonly string[],
	matched: number,
	declared: number,
): void {
	if (globs.length === 0) return;

	if (matched === 0) {
		logger.warn(
			`\n⚠️  The constructs glob matched no files, so nothing was declared.\n` +
				`   Patterns: ${globs.join(', ')}\n` +
				`   Nothing will be provisioned — no containers, no env keys, no ` +
				`resources.\n` +
				`   A common cause is depth: '*.ts' matches one level, '**/*.ts' ` +
				`matches any.`,
		);
		return;
	}

	if (declared === 0) {
		logger.warn(
			`\n⚠️  The constructs glob matched ${matched} file(s) but none declared ` +
				`anything.\n` +
				`   Patterns: ${globs.join(', ')}\n` +
				`   Discovery keeps exports with an 'id' that can 'declare()'. A ` +
				`construct that is\n` +
				`   built but never exported is invisible to it.`,
		);
	}
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
