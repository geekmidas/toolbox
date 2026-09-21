import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { EndpointGenerator } from '../EndpointGenerator';
import { clearZodGlobalRegistry } from '../Generator';

describe('clearZodGlobalRegistry', () => {
	it('removes a registered id from the global registry', () => {
		const registry = (
			globalThis as {
				__zod_globalRegistry?: { _idmap?: Map<string, unknown> };
			}
		).__zod_globalRegistry;

		z.object({ x: z.string() }).meta({ id: 'BustCacheSchema_A' });
		expect(registry?._idmap?.has('BustCacheSchema_A')).toBe(true);

		// The contract is that the id is gone, asserted on the registry itself.
		// This used to be asserted by re-registering and expecting a throw, which
		// stopped meaning anything in Zod 4.6: a duplicate id is accepted now
		// rather than rejected. That made the test pass for the wrong reason
		// first, and then fail for the wrong reason — neither of which was ever
		// about `clearZodGlobalRegistry`.
		clearZodGlobalRegistry();
		expect(registry?._idmap?.has('BustCacheSchema_A')).toBe(false);

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
import { z } from 'zod/v4';
import { RestApi } from '@geekmidas/constructs/rest-api';

/** Endpoints are built from a surface now. */
const api = new RestApi('Test', { defaultAuthorizer: 'none' });

export const getRentalAgreement = api
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
