/**
 * The test manifest: what `gkm test` knows about an app, written down for the
 * suite it starts.
 *
 * `gkm test` discovers the constructs, reconciles the test stage and resolves
 * its environment — then, until this existed, threw all of it away and left a
 * test to declare it again by hand. The manifest keeps it: which construct and
 * endpoint is exported where, and the environment the test stage resolved,
 * under the keys the constructs themselves derive. A feature test is built from
 * it, so nothing a test says can drift from what the app declares.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where an export lives: what an import statement has to say. */
export interface TestManifestSource {
	/** Absolute path to the module. */
	file: string;
	/** The name it is exported as. */
	export: string;
}

export interface TestManifest {
	/** The stage the environment was resolved for — `test`. */
	stage: string;
	/** Every construct the app declares, by id. */
	constructs: Record<string, { kind: string; source: TestManifestSource }>;
	/** Every endpoint, and the surface that serves it. */
	endpoints: { surface: string; source: TestManifestSource }[];
	/**
	 * The test stage's environment — reconcile's output, keyed as the
	 * constructs derive their keys.
	 */
	env: Record<string, string>;
}

/** The environment variable `gkm test` names the manifest in. */
export const TEST_MANIFEST_ENV = 'GKM_TEST_MANIFEST';

/**
 * Read a test manifest: from a path, a `file:` URL, or — given nothing — the
 * one `gkm test` named in `GKM_TEST_MANIFEST`.
 */
export function loadTestManifest(from?: string | URL): TestManifest {
	const location = from ?? process.env[TEST_MANIFEST_ENV];
	if (!location) throw new NoTestManifest();

	const path =
		location instanceof URL || location.startsWith('file:')
			? fileURLToPath(location)
			: location;

	return JSON.parse(readFileSync(path, 'utf-8')) as TestManifest;
}

/** A feature test ran without a manifest to build itself from. */
export class NoTestManifest extends Error {
	constructor() {
		super(
			`No test manifest: run the suite with \`gkm test\`, which writes one ` +
				`and names it in ${TEST_MANIFEST_ENV}.`,
		);
		this.name = 'NoTestManifest';
	}
}
