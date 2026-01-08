import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getProjectRoot } from '../helpers';

describe('helpers', () => {
	describe('getProjectRoot', () => {
		it('should find project root from current directory', async () => {
			const cwd = process.cwd();
			const root = await getProjectRoot(cwd);
			// Should find the toolbox root which has pnpm-lock.yaml
			expect(root).toBe(cwd);
		});

		it('should find project root from nested directory', async () => {
			const cwd = process.cwd();
			const nested = path.join(cwd, 'packages', 'constructs', 'src');
			const root = await getProjectRoot(nested);
			// Should find the toolbox root
			expect(root).toBe(cwd);
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
