import { describe, expect, it } from 'vitest';
import { normalizeWorkspace } from '../index';
import {
	assertDeployedStage,
	deployedProblems,
	stageProblems,
	validateStages,
} from '../stages';
import type { WorkspaceConfig } from '../types';

describe('stageProblems', () => {
	it('accepts whatever the project calls its stages', () => {
		expect(
			stageProblems({
				local: 'dev',
				deployed: ['staging', 'prod'],
				protected: ['prod'],
			}),
		).toEqual([]);
		expect(
			stageProblems({ local: 'development', deployed: ['production'] }),
		).toEqual([]);
	});

	it('refuses a local stage that is also deployed', () => {
		// Secrets are stored per stage name: the two would share them.
		expect(stageProblems({ local: 'dev', deployed: ['dev', 'prod'] })).toEqual([
			'"dev" is both the local stage and a deployed one; they would share secrets',
		]);
	});

	it('refuses a protected stage that is not deployed', () => {
		expect(
			stageProblems({ local: 'dev', deployed: ['prod'], protected: ['live'] }),
		).toEqual(['protected stage "live" is not a deployed stage']);
	});

	it('reserves test for gkm test', () => {
		expect(stageProblems({ local: 'test', deployed: ['prod'] })).toEqual([
			'stage "test" is reserved for gkm test',
		]);
		expect(stageProblems({ local: 'dev', deployed: ['test'] })).toEqual([
			'stage "test" is reserved for gkm test',
		]);
	});

	it('refuses a name that cannot be part of a physical name', () => {
		for (const bad of ['Prod', 'prod_eu', '1prod', 'prod eu', '']) {
			expect(stageProblems({ local: 'dev', deployed: [bad] })).toHaveLength(1);
		}
	});

	it('names a missing block', () => {
		expect(stageProblems(undefined)[0]).toContain('`stages` is required');
	});
});

describe('deployedProblems', () => {
	it('refuses a stage listed twice', () => {
		expect(deployedProblems(['prod', 'staging', 'prod'])).toEqual([
			'stage "prod" is listed twice',
		]);
	});

	it('checks the list on its own, with no local stage to compare', () => {
		expect(deployedProblems(['staging', 'prod'])).toEqual([]);
	});
});

describe('validateStages', () => {
	it('returns a valid block unchanged', () => {
		const stages = { local: 'dev', deployed: ['prod'] };
		expect(validateStages(stages)).toBe(stages);
	});

	it('throws with every problem listed', () => {
		expect(() =>
			validateStages({ local: 'prod', deployed: ['prod', 'prod'] }),
		).toThrow(/listed twice[\s\S]*both the local stage/);
	});
});

describe('assertDeployedStage', () => {
	const stages = { local: 'dev', deployed: ['staging', 'prod'] };

	it('lets a declared stage through', () => {
		expect(() => assertDeployedStage(stages, 'prod')).not.toThrow();
	});

	it('refuses a stage the project does not deploy to', () => {
		// A typo would otherwise provision a whole second environment.
		expect(() => assertDeployedStage(stages, 'production')).toThrow(
			'"production" is not a deployed stage. gkm.config.ts deploys to: staging, prod.',
		);
	});

	it('refuses the local stage', () => {
		expect(() => assertDeployedStage(stages, 'dev')).toThrow(
			'"dev" is not a deployed stage',
		);
	});
});

describe('normalizeWorkspace without stages', () => {
	it('throws naming stages rather than inventing one', () => {
		const config = { name: 'shop', apps: {} } as unknown as WorkspaceConfig;

		expect(() => normalizeWorkspace(config, '/project')).toThrow(
			/`stages` is required/,
		);
	});
});
