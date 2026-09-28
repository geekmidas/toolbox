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
				// Test code, not the code under test: spec files, their helpers and
				// type-level tests live here, and measuring them counted helpers a
				// given run did not call as untested source.
				'**/__tests__/**',
				'**/*.test-d.ts',
			],
			include: ['packages/*/src/**/*.{ts,tsx}'],
			thresholds: {
				functions: 85,
				branches: 85,
			},
		},
		benchmark: {
			include: ['**/__benchmarks__/**/*.bench.ts'],
			exclude: ['**/node_modules/**', '**/dist/**'],
		},
	},
});
