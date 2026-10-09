/**
 * The surface URLs an `sst deploy` reports.
 *
 * SST writes whatever `run()` in `sst.config.ts` returns to
 * `.sst/outputs.json` after every successful deploy — `{"Api": "https://…"}`.
 * What `run()` returns is the project's to write, so this reads it leniently:
 * nested objects are walked, anything that is not an http(s) URL is ignored,
 * and an output names a surface by its id in any casing, with or without a
 * `Url` suffix (`Api`, `api`, `ApiUrl`, `API_URL`, `Api.url`).
 */

import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { kebabCase } from '@geekmidas/manifest';
import { GkmError } from '../../errors';

/** Where SST leaves the last successful deploy's outputs, under the project. */
export const SST_OUTPUTS_FILE = join('.sst', 'outputs.json');

/** `.sst/outputs.json` is there, and is not JSON. */
export class SstOutputsUnreadable extends GkmError {
	constructor(
		readonly path: string,
		readonly reason: string,
	) {
		super(
			`Could not read SST's outputs at ${path}: ${reason}. It is rewritten by every successful \`sst deploy\`; delete it and deploy again.`,
		);
		this.name = 'SstOutputsUnreadable';
	}
}

/**
 * Remove what an earlier deploy wrote, so the outputs read after this one
 * are this one's — not another stage's, deployed from the same checkout.
 */
export async function clearOutputs(cwd: string): Promise<void> {
	await rm(join(cwd, SST_OUTPUTS_FILE), { force: true });
}

/** The deploy's outputs, or `{}` when it wrote none. */
export async function readOutputs(cwd: string): Promise<unknown> {
	const path = join(cwd, SST_OUTPUTS_FILE);
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new SstOutputsUnreadable(
			path,
			error instanceof Error ? error.message : String(error),
		);
	}
}

/** Every http(s) URL in `outputs`, by its key path: `['Api', 'url']`. */
function urlsIn(
	value: unknown,
	path: string[] = [],
	found: { path: string[]; url: string }[] = [],
): { path: string[]; url: string }[] {
	if (typeof value === 'string') {
		if (isHttpUrl(value)) found.push({ path, url: value });
	} else if (value && typeof value === 'object' && !Array.isArray(value)) {
		for (const [key, child] of Object.entries(value)) {
			urlsIn(child, [...path, key], found);
		}
	}
	return found;
}

function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * The app an output's key path names, kebab-cased as app keys are: its last
 * segment, without a `url` suffix — or its parent's, when the last segment
 * is only `url`. Exact names are tried first, so an app called `api-url`
 * still finds `ApiUrl`.
 */
function namesOf(path: string[]): string[] {
	const names: string[] = [];
	for (const segment of [...path].reverse()) {
		const name = kebabCase(segment);
		names.push(name);
		const bare = name.replace(/-?url$/, '');
		if (bare) {
			names.push(bare);
			break;
		}
	}
	return names;
}

/**
 * Each app's URL from the outputs, for the apps given. An app no output
 * names is left out.
 */
export function surfaceUrls(
	outputs: unknown,
	apps: readonly string[],
): Record<string, string> {
	const found = urlsIn(outputs);
	const urls: Record<string, string> = {};
	for (const app of apps) {
		// An exact name beats a stripped one, wherever each is in the file.
		const exact = found.find(({ path }) => namesOf(path)[0] === app);
		const loose = found.find(({ path }) => namesOf(path).includes(app));
		const match = exact ?? loose;
		if (match) urls[app] = match.url;
	}
	return urls;
}
