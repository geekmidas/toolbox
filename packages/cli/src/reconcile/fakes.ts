/**
 * Fakes, read from where the convention puts them.
 *
 * `test/fakes/<id>.ts` default-exports `fake.app(…)` or `fake.image(…)` for an
 * external API, and `fake.credential(…)` for a credential. The construct never
 * names it — that is what keeps a fake out of a deployed bundle — so this is
 * the one place it is found, by the same rule that finds a database's factory
 * in `test/factories/<id>.ts`.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConstructManifest } from '@geekmidas/manifest';
import { kebabCase } from '@geekmidas/manifest';
import { GkmError } from '../errors';
import type { Plan } from './plan';

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
	kind: 'app' | 'image' | 'credential';
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
		if (!file) throw new NoFake(id, `${fakeBase(root, id)}.ts`);
		const value = await importFake(file);
		if (value.kind === 'credential') throw new NotAFake(file);

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

/**
 * Each credential's fake value, as the JSON `<ID>_CREDENTIALS` holds, keyed by
 * id — for the credentials that have a fake. Unlike an external API's, a
 * credential's fake is optional here: a stage that stores the real value
 * needs none. The test stage's own check (`assertTestCredentials`) is what
 * refuses one with neither.
 *
 * @throws {NotAFake} when the file's default export is not a credential's fake.
 */
export async function readCredentialFakes(
	root: string,
	manifest: ConstructManifest,
): Promise<Record<string, string>> {
	const values: Record<string, string> = {};

	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration?.kind !== 'credential') continue;

		const file = await fakeFile(join(root, DEFAULT_FAKES_DIR), id);
		if (!file) continue;
		const value = await importFake(file);
		if (value.kind !== 'credential') throw new NotAFake(file);

		values[id] = JSON.stringify(value.credentials);
	}

	return values;
}

/**
 * A credential the test stage has no value for: no fake, and nothing stored.
 * Raised when the stage is set up, before a test reaches it — not as a schema
 * error inside the handler that first asked.
 */
export class CredentialHasNoTestValue extends GkmError {
	constructor(
		readonly id: string,
		readonly key: string,
		readonly file: string,
	) {
		super(
			`'${id}' is a credential, and the test stage has no value for ${key}: ` +
				`no fake, and none stored — a stage set up fresh, as CI's ` +
				`auto-setup does, holds no third party's credentials. Give it a ` +
				`fake: create ${file}, default-exporting ` +
				`fake.credential(…) from @geekmidas/constructs/credential. It is ` +
				`read only by gkm test and gkm dev --fake; a deployed stage still ` +
				`needs the real value (gkm secrets:add --stage <stage>).`,
		);
		this.name = 'CredentialHasNoTestValue';
	}
}

/**
 * Every credential the test stage must hand its suite, with the value it
 * resolved — a fake's, or one the stage stores.
 *
 * @throws {CredentialHasNoTestValue} for the first one with neither.
 */
export function assertTestCredentials(
	root: string,
	plan: Pick<Plan, 'resources'>,
	env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
	const values: Record<string, string> = {};

	for (const { id, kind, envKey } of plan.resources) {
		if (kind !== 'credential') continue;

		const value = env[envKey];
		if (value === undefined) {
			throw new CredentialHasNoTestValue(
				id,
				envKey,
				`${fakeBase(root, id)}.ts`,
			);
		}
		values[envKey] = value;
	}

	return values;
}

/** `<root>/test/fakes/<id>`, without an extension. */
function fakeBase(root: string, id: string): string {
	return join(root, DEFAULT_FAKES_DIR, kebabCase(id));
}

/** The first of `<id>.ts`, `.mts`, `.js`, `.mjs` that exists. */
async function fakeFile(
	folder: string,
	id: string,
): Promise<string | undefined> {
	const base = join(folder, kebabCase(id));
	for (const extension of ['.ts', '.mts', '.js', '.mjs']) {
		const file = `${base}${extension}`;
		const exists = await access(file).then(
			() => true,
			() => false,
		);
		if (exists) return file;
	}

	return undefined;
}

/**
 * A fake file's default export.
 *
 * @throws {NotAFake} when it is not a fake.
 */
async function importFake(file: string): Promise<FakeExport> {
	const module = (await import(pathToFileURL(file).href)) as {
		default?: unknown;
	};
	const value = module.default;
	if (!isFakeExport(value)) throw new NotAFake(file);
	return value;
}

function isFakeExport(value: unknown): value is FakeExport {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { [FAKE]?: unknown })[FAKE] === true
	);
}

/** An external API with no fake for a local stage to call. */
export class NoFake extends GkmError {
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
export class NotAFake extends GkmError {
	constructor(readonly file: string) {
		super(
			`${file} is where a fake lives, and its default export is not one ` +
				`for its construct. For an external API, export default ` +
				`fake.app(handler, { credentials }) or ` +
				`fake.image(image, { port, credentials }); for a credential, ` +
				`fake.credential(value).`,
		);
		this.name = 'NotAFake';
	}
}
