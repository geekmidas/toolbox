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
				services: { db: true, cache: false, mail: false, storage: false },
			} as TemplateOptions),
		).toThrow(SstNeedsRegion);
	});
});
