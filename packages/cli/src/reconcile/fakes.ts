/**
 * External APIs' fakes, read from where the convention puts them.
 *
 * `test/fakes/<id>.ts` default-exports `fake.app(…)` or `fake.image(…)`. The
 * construct never names it — that is what keeps a fake out of a deployed
 * bundle — so this is the one place it is found, by the same rule that finds a
 * database's factory in `test/factories/<id>.ts`.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConstructManifest } from '@geekmidas/manifest';
import { kebabCase } from '@geekmidas/manifest';

/** Where a project keeps its external APIs' fakes, relative to its root. */
export const DEFAULT_FAKES_DIR = 'test/fakes';

/** One external API's fake, as the local target needs it. */
export interface LocalFake {
	/** The file it was read from — what the harness and `gkm dev` import. */
	file: string;
	/** The image to run, for a fake the provider publishes. */
	image?: string;
	/** The port that image listens on inside its container. */
	port?: number;
	/** What the fake accepts, as the JSON `<ID>_CREDENTIALS` holds. */
	credentials: string;
}

/** The marker `fake.app` and `fake.image` set — the same registered symbol. */
const FAKE = Symbol.for('@geekmidas/constructs/fake');

interface FakeExport {
	kind: 'app' | 'image';
	image?: string;
	port?: number;
	credentials: unknown;
}

/**
 * The fake for every external API the manifest declares, keyed by id.
 *
 * @throws {NoFake} when an external API has no file, since a local stage would
 * otherwise have nothing to call.
 * @throws {NotAFake} when the file's default export is not one.
 */
export async function readFakes(
	root: string,
	manifest: ConstructManifest,
): Promise<Record<string, LocalFake>> {
	const fakes: Record<string, LocalFake> = {};

	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration?.kind !== 'external-api') continue;

		const file = await fakeFile(join(root, DEFAULT_FAKES_DIR), id);
		const module = (await import(pathToFileURL(file).href)) as {
			default?: unknown;
		};
		const value = module.default;
		if (!isFakeExport(value)) throw new NotAFake(file);

		fakes[id] = {
			file,
			...(value.kind === 'image'
				? { image: value.image, port: value.port }
				: {}),
			credentials: JSON.stringify(value.credentials),
		};
	}

	return fakes;
}

/** The first of `<id>.ts`, `.mts`, `.js`, `.mjs` that exists. */
async function fakeFile(folder: string, id: string): Promise<string> {
	const base = join(folder, kebabCase(id));
	for (const extension of ['.ts', '.mts', '.js', '.mjs']) {
		const file = `${base}${extension}`;
		const exists = await access(file).then(
			() => true,
			() => false,
		);
		if (exists) return file;
	}

	throw new NoFake(id, `${base}.ts`);
}

function isFakeExport(value: unknown): value is FakeExport {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { [FAKE]?: unknown })[FAKE] === true
	);
}

/** An external API with no fake for a local stage to call. */
export class NoFake extends Error {
	constructor(
		readonly id: string,
		readonly file: string,
	) {
		super(
			`'${id}' is an external API, and a local stage calls its fake rather ` +
				`than the provider — but there is none. Create ${file}, ` +
				`default-exporting fake.app(…) or fake.image(…) from ` +
				`@geekmidas/constructs/external-api.`,
		);
		this.name = 'NoFake';
	}
}

/** A file in the fakes folder whose default export is not a fake. */
export class NotAFake extends Error {
	constructor(readonly file: string) {
		super(
			`${file} is where a fake lives, and its default export is not one. ` +
				`Export default fake.app(handler, { credentials }) or ` +
				`fake.image(image, { port, credentials }).`,
		);
		this.name = 'NotAFake';
	}
}
