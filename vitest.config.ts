import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'jsdom',
		testTimeout: 10000,
		projects: ['packages/*'],
		coverage: {
			provider: 'v8',
			exclude: [
				'**/dist/**',
				'**/node_modules/**',
				'**/*.d.ts',
				'**/examples/**',
				'**/exports/**',
				'**/.gkm/**',
				'**/__benchmarks__/**',
				'**/packages/ui/**',
				'**/*.stories.tsx',
				// Subprocess files - can't be instrumented as they run in child processes
				'**/sniffer-loader.ts',
				'**/sniffer-hooks.ts',
				'**/sniffer-worker.ts',
				'**/sniffer-envkit-patch.ts',
				'**/sniffer-routes-worker.ts',
				// The commander wiring: each command's options and a call into the
				// function that does the work, which has tests of its own.
				'packages/cli/src/index.ts',
				'**/__fixtures__/**',
			],
			include: ['packages/*/src/**/*.{ts,tsx}'],
			// Re-baselined for Vitest 4's AST-aware V8 remapping, not lowered for
			// any code: the same 5,315 tests over the same source measured 85.21%
			// functions / 86.81% branches under Vitest 3 and 76.34% / 66.2% now,
			// because remapping counts every branch and function in the source
			// rather than only the blocks V8 reported. Held at the new floor so
			// a regression still fails; raising them is its own work.
			thresholds: {
				functions: 76,
				branches: 66,
			},
		},
		benchmark: {
			include: ['**/__benchmarks__/**/*.bench.ts'],
			exclude: ['**/node_modules/**', '**/dist/**'],
		},
	},
});
