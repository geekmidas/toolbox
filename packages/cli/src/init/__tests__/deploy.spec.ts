import { describe, expect, it } from 'vitest';
import { generateDeployFiles, SstNeedsRegion } from '../generators/deploy';
import type { TemplateOptions } from '../templates/index';

describe('generateDeployFiles', () => {
	it('refuses an SST scaffold with no region to write', () => {
		expect(() =>
			generateDeployFiles({
				name: 'beetlefit',
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
});
