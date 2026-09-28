import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeFiles } from '../docker';

describe('composeFiles', () => {
	let root: string;
	const generated = () => join(root, 'docker-compose.constructs.yml');

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-compose-files-'));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('is the generated file alone when the project has none of its own', () => {
		expect(composeFiles(generated())).toEqual(['-f', generated()]);
	});

	it("merges the project's docker-compose.yml after it, so the project wins", () => {
		// An `image:` there pins a container the generated file derived; the
		// later file is the one compose lets override.
		writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n');

		expect(composeFiles(generated())).toEqual([
			'-f',
			generated(),
			'-f',
			join(root, 'docker-compose.yml'),
		]);
	});
});
