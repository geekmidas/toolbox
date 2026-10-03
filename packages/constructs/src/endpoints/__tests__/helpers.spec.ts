import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getProjectRoot } from '../helpers';

describe('helpers', () => {
	describe('getProjectRoot', () => {
		// The toolbox root — the directory holding pnpm-lock.yaml — found from
		// this file, not from `process.cwd()`: the suite runs from the repo root
		// in CI and from the package locally, and only one of those is the root.
		const toolboxRoot = path.resolve(import.meta.dirname, '../../../../..');

		it('should find project root from the root itself', async () => {
			expect(await getProjectRoot(toolboxRoot)).toBe(toolboxRoot);
		});

		it('should find project root from nested directory', async () => {
			const nested = path.join(toolboxRoot, 'packages', 'constructs', 'src');
			expect(await getProjectRoot(nested)).toBe(toolboxRoot);
		});

		it('should return root when reaching filesystem root', async () => {
			// This tests the base case - when we reach '/', return '/'
			const root = await getProjectRoot('/');
			expect(root).toBe('/');
		});

		it('should handle directory with no lock file', async () => {
			// Create a temp directory path that definitely has no lock file
			// It should traverse up until it finds one or reaches root
			const tempPath = '/tmp/test-no-lock-file-12345';
			const root = await getProjectRoot(tempPath);
			// Should eventually reach '/' or find a project root
			expect(typeof root).toBe('string');
		});
	});
});
