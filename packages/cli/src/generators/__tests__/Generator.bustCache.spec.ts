import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { EndpointGenerator } from '../EndpointGenerator';
import { clearZodGlobalRegistry } from '../Generator';

describe('clearZodGlobalRegistry', () => {
	it('removes an id from the global registry so the same id can be re-registered', () => {
		// Register once — succeeds
		z.object({ x: z.string() }).meta({ id: 'BustCacheSchema_A' });

		// Re-registering without clearing throws
		expect(() =>
			z.object({ y: z.string() }).meta({ id: 'BustCacheSchema_A' }),
		).toThrow(/already exists in the registry/);

		// After clearing, the id can be registered again
		clearZodGlobalRegistry();
		expect(() =>
			z.object({ z: z.string() }).meta({ id: 'BustCacheSchema_A' }),
		).not.toThrow();
	});

	it('is a no-op when the registry has not been initialised', () => {
		// Temporarily remove the global registry
		const g = globalThis as { __zod_globalRegistry?: unknown };
		const saved = g.__zod_globalRegistry;
		delete g.__zod_globalRegistry;

		try {
			// Should not throw even though the registry does not exist
			expect(() => clearZodGlobalRegistry()).not.toThrow();
		} finally {
			g.__zod_globalRegistry = saved;
		}
	});
});

describe('Generator.load — bustCache integration smoke test', () => {
	itWithDir(
		'loads an endpoint with .meta({ id }) across multiple cache-busted reloads without throwing',
		async ({ dir }) => {
			// Mirrors the real scenario: endpoint output schema registers an
			// id. Reloading on file change must not throw a duplicate-id error.
			const endpointFile = join(dir, 'getRentalAgreement.ts');
			await writeFile(
				endpointFile,
				`
import { e } from '@geekmidas/constructs/endpoints';
import { z } from 'zod/v4';

export const getRentalAgreement = e
  .get('/rental-agreement')
  .output(z.object({ content: z.string() }).meta({ id: 'RentalAgreementOutput' }))
  .handle(async () => ({ content: 'pdf-content' }));
`,
			);

			const generator = new EndpointGenerator();
			const patterns = join(dir, '**/*.ts');

			// Simulates multiple `gkm dev` reloads
			for (let i = 0; i < 3; i++) {
				const loaded = await generator.load(patterns, process.cwd(), true);
				expect(loaded).toHaveLength(1);
				expect(loaded[0].key).toBe('getRentalAgreement');
			}
		},
	);
});
