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
				'**/__fixtures__/**',
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
