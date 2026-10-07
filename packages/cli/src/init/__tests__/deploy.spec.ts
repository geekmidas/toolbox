import { describe, expect, it } from 'vitest';
import { generateDeployFiles, SstNeedsRegion } from '../generators/deploy';
import type { TemplateOptions } from '../templates/index';

describe('generateDeployFiles', () => {
	it('refuses an SST scaffold with no region to write', () => {
		expect(() =>
			generateDeployFiles({
				name: 'shop',
				template: 'fullstack',
				monorepo: true,
				deployTarget: 'sst',
				stages: { local: 'dev', deployed: ['prod'] },
				constructs: {
					database: true,
					cache: false,
					mail: false,
					uploads: false,
				},
			} as TemplateOptions),
		).toThrow(SstNeedsRegion);
	});

	it('returns each surface URL from run(), for gkm deploy to health-check', () => {
		const [config] = generateDeployFiles({
			name: 'shop',
			template: 'fullstack',
			monorepo: true,
			deployTarget: 'sst',
			region: 'eu-west-1',
			stages: { local: 'dev', deployed: ['prod'] },
			constructs: {
				database: false,
				cache: false,
				mail: false,
				uploads: false,
			},
		} as TemplateOptions);

		expect(config!.path).toBe('sst.config.ts');
		// SST writes what run() returns to .sst/outputs.json.
		expect(config!.content).toContain(
			".filter(([, c]) => c.kind === 'rest-api' || c.kind === 'site')",
		);
		expect(config!.content).toContain(
			'.map(([id]) => [id, provisioned[id]!.provides().url])',
		);
	});
});
