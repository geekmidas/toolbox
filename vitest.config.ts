import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
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
      ],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      thresholds: {
        functions: 85,
        lines: 77,
        branches: 85,
      },
    },
  },
});
