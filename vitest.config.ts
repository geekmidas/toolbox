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
				// Runs only under `gkm test`, which writes the manifest it is built
				// from and preloads the credentials every construct reads — so its
				// test is an app driven that way: kitchen-sink's suite, run in CI by
				// its own step. A package run has neither, and faking both is how a
				// spec ends up testing the fake.
				'packages/constructs/src/testing/featureTest.ts',
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
