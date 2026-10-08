import { describe, expect, it } from 'vitest';
import { UndeclaredStage } from '../../workspace/stages';
import type { StagesConfig } from '../../workspace/types';
import { DispatchNamesNoStage, planStages } from '../plan';

const stages: StagesConfig = {
	local: 'dev',
	deployed: ['staging', 'prod'],
	protected: ['prod'],
};

describe('planStages', () => {
	it('builds every deployed stage on a push, and deploys the unprotected', () => {
		expect(planStages(stages, { event: 'push' })).toEqual({
			build: ['staging', 'prod'],
			deploy: ['staging'],
		});
	});

	it('deploys every deployed stage on a push when none is protected', () => {
		expect(
			planStages(
				{ local: 'dev', deployed: ['staging', 'prod'] },
				{
					event: 'push',
				},
			),
		).toEqual({ build: ['staging', 'prod'], deploy: ['staging', 'prod'] });
		expect(
			planStages(
				{ local: 'dev', deployed: ['staging'], protected: [] },
				{ event: 'push' },
			),
		).toEqual({ build: ['staging'], deploy: ['staging'] });
	});

	it('deploys only the protected stages on a release, and builds nothing', () => {
		expect(planStages(stages, { event: 'release' })).toEqual({
			build: [],
			deploy: ['prod'],
		});
	});

	it('deploys nothing on a release when no stage is protected', () => {
		expect(
			planStages({ local: 'dev', deployed: ['prod'] }, { event: 'release' }),
		).toEqual({ build: [], deploy: [] });
	});

	it('deploys the one stage a manual run names, protected or not', () => {
		expect(
			planStages(stages, { event: 'workflow_dispatch', stage: 'prod' }),
		).toEqual({ build: [], deploy: ['prod'] });
		expect(
			planStages(stages, { event: 'workflow_dispatch', stage: ' staging ' }),
		).toEqual({ build: [], deploy: ['staging'] });
	});

	it('refuses a manual run naming a stage the project does not deploy', () => {
		expect(() =>
			planStages(stages, { event: 'workflow_dispatch', stage: 'dev' }),
		).toThrow(UndeclaredStage);
		expect(() =>
			planStages(stages, { event: 'workflow_dispatch', stage: 'production' }),
		).toThrow('"production" is not a deployed stage');
	});

	it('refuses a manual run naming no stage', () => {
		for (const stage of [undefined, '', '  ']) {
			const run = () =>
				planStages(stages, {
					event: 'workflow_dispatch',
					...(stage === undefined ? {} : { stage }),
				});
			expect(run).toThrow(DispatchNamesNoStage);
			expect(run).toThrow('staging, prod');
		}
	});

	it.each([
		'pull_request',
		'schedule',
		'workflow_run',
		'',
	])('builds and deploys nothing on %j', (event) => {
		expect(planStages(stages, { event })).toEqual({ build: [], deploy: [] });
	});

	it('ignores a stage given with any event but a manual run', () => {
		expect(planStages(stages, { event: 'release', stage: 'staging' })).toEqual({
			build: [],
			deploy: ['prod'],
		});
	});

	it('hands back copies, not the config’s own lists', () => {
		const plan = planStages(stages, { event: 'push' });
		plan.build.push('x');
		expect(stages.deployed).toEqual(['staging', 'prod']);
	});
});
