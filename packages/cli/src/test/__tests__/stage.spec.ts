import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoStageToTest, testCommand } from '../index';

describe('testCommand', () => {
	let dir: string;
	let cwd: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'gkm-test-stage-'));
		cwd = process.cwd();
		process.chdir(dir);
	});

	afterEach(() => {
		process.chdir(cwd);
		rmSync(dir, { recursive: true, force: true });
	});

	it('refuses to guess a stage where no config declares one', async () => {
		await expect(testCommand()).rejects.toThrow(NoStageToTest);
	});
});
