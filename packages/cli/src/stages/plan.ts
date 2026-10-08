/**
 * Which stages a workflow run builds and deploys, from the event that started
 * it and the project's `stages`.
 *
 * The rules live here, in tested code, rather than in a workflow's YAML or in
 * the action that runs `gkm stages --github-output`: a project's deploy
 * workflow names no stage, and what it does for each event is decided by the
 * CLI the project installed.
 *
 * | event               | build              | deploy                          |
 * | ------------------- | ------------------ | ------------------------------- |
 * | `push`              | every deployed     | deployed, less the protected    |
 * | `release`           | none               | the protected                   |
 * | `workflow_dispatch` | none               | the one stage named             |
 * | anything else       | none               | none                            |
 *
 * A push builds every deployed stage, protected ones included, so a release
 * deploys images built from the very commit its tag names; a release and a
 * manual run deploy what a push already built.
 */

import { UndeclaredStage } from '../workspace/stages.js';
import type { StagesConfig } from '../workspace/types.js';

export interface StagePlan {
	/** The stages whose images this run builds and pushes. */
	build: string[];
	/** The stages this run deploys. */
	deploy: string[];
}

export interface PlanInput {
	/** The GitHub event name: `push`, `release`, `workflow_dispatch`, … */
	event: string;
	/** The stage a `workflow_dispatch` names. */
	stage?: string;
}

export function planStages(stages: StagesConfig, input: PlanInput): StagePlan {
	const kept = stages.protected ?? [];

	switch (input.event) {
		case 'push':
			return {
				build: [...stages.deployed],
				deploy: stages.deployed.filter((stage) => !kept.includes(stage)),
			};
		case 'release':
			return { build: [], deploy: [...kept] };
		case 'workflow_dispatch': {
			const stage = input.stage?.trim();
			if (!stage) throw new DispatchNamesNoStage(stages.deployed);
			if (!stages.deployed.includes(stage)) {
				throw new UndeclaredStage(stage, stages.deployed);
			}
			return { build: [], deploy: [stage] };
		}
		default:
			return { build: [], deploy: [] };
	}
}

/**
 * A manual run with no stage. Refused rather than read as "nothing to do", so
 * a run started with the field left empty fails where it can be seen.
 */
export class DispatchNamesNoStage extends Error {
	constructor(readonly deployed: readonly string[]) {
		super(
			`A manual run deploys one stage, and none was given. Run the workflow again with stage set to one of: ${deployed.join(', ') || 'nothing yet — gkm.config.ts deploys to no stage'}.`,
		);
		this.name = 'DispatchNamesNoStage';
	}
}
