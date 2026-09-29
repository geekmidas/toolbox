import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	loadTestManifest,
	NoTestManifest,
	TEST_MANIFEST_ENV,
	type TestManifest,
} from '../manifest';

const manifest: TestManifest = {
	stage: 'test',
	constructs: {
		Database: {
			kind: 'database',
			source: { file: '/app/constructs/database.ts', export: 'database' },
		},
	},
	endpoints: [],
	env: { DATABASE_URL: 'postgres://localhost/app_test' },
};

describe('loadTestManifest', () => {
	let dir: string;
	let path: string;
	let previous: string | undefined;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'gkm-manifest-'));
		path = join(dir, 'manifest.json');
		await writeFile(path, JSON.stringify(manifest));
		previous = process.env[TEST_MANIFEST_ENV];
	});

	afterEach(async () => {
		if (previous === undefined) delete process.env[TEST_MANIFEST_ENV];
		else process.env[TEST_MANIFEST_ENV] = previous;
		await rm(dir, { recursive: true, force: true });
	});

	it('reads one from a path', () => {
		expect(loadTestManifest(path)).toEqual(manifest);
	});

	it('reads one from a file URL — what the generated harness passes', () => {
		expect(loadTestManifest(pathToFileURL(path))).toEqual(manifest);
		expect(loadTestManifest(pathToFileURL(path).href)).toEqual(manifest);
	});

	it('reads the one gkm test named, given nothing', () => {
		process.env[TEST_MANIFEST_ENV] = path;

		expect(loadTestManifest()).toEqual(manifest);
	});

	it('says to run the suite through gkm test when there is none', () => {
		delete process.env[TEST_MANIFEST_ENV];

		expect(() => loadTestManifest()).toThrow(NoTestManifest);
	});
});
