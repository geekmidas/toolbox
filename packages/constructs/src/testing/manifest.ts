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

import { existsSync, readFileSync } from 'node:fs';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import type { TestStage } from '../stages';

/** Where an export lives: what an import statement has to say. */
export interface TestManifestSource {
	/** Absolute path to the module. */
	file: string;
	/** The name it is exported as. */
	export: string;
}

export interface TestManifest {
	/** The stage the environment was resolved for — `test`. */
	stage: TestStage;
	/** Every construct the app declares, by id. */
	constructs: Record<string, { kind: string; source: TestManifestSource }>;
	/** Every endpoint, and the surface that serves it. */
	endpoints: { surface: string; source: TestManifestSource }[];
	/**
	 * Every topic subscriber — what a topic's events are delivered to. Not a
	 * construct, so not in `constructs`: the build finds them, as it finds
	 * endpoints.
	 */
	subscribers?: { source: TestManifestSource }[];
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

	trustLocalEdge();

	const path =
		location instanceof URL || location.startsWith('file:')
			? fileURLToPath(location)
			: location;

	return JSON.parse(readFileSync(path, 'utf-8')) as TestManifest;
}

let trusted = false;

/**
 * Trust the local edge's certificate authority in this thread.
 *
 * `NODE_EXTRA_CA_CERTS` does it for a process started with it — which a
 * suite started by `gkm test` is, and one started by plain `vitest` or an
 * editor is not: its setup only learns the path once Vitest is running, and a
 * worker *thread* shares that process and keeps a TLS store of its own. Every
 * feature test loads the manifest, so this is the one place each worker passes
 * through.
 */
function trustLocalEdge(): void {
	const certificate = process.env.NODE_EXTRA_CA_CERTS;
	if (trusted || !certificate || !existsSync(certificate)) return;
	trusted = true;

	tls.setDefaultCACertificates([
		...tls.getCACertificates('default'),
		readFileSync(certificate, 'utf-8'),
	]);
}

/** A feature test ran without a manifest to build itself from. */
export class NoTestManifest extends Error {
	constructor() {
		super(
			`No test manifest: run the suite with \`gkm test\`, or add ` +
				`\`globalSetup: ['@geekmidas/cli/vitest']\` to the root vitest config — ` +
				`either writes one and names it in ${TEST_MANIFEST_ENV}.`,
		);
		this.name = 'NoTestManifest';
	}
}
