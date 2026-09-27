import type { StagesConfig } from './types.js';

/**
 * What `gkm test` runs as. The CLI's own, so no project stage may take it:
 * its containers are torn down and rebuilt between runs.
 */
export const TEST_STAGE = 'test';

/** A stage becomes part of every physical name, so it has to fit in one. */
const STAGE_NAME = /^[a-z][a-z0-9-]*$/;

/** Everything wrong with one stage name, or nothing. */
function nameProblems(name: string): string[] {
	const problems: string[] = [];
	if (!STAGE_NAME.test(name)) {
		problems.push(
			`stage "${name}" must be lowercase letters, digits and hyphens, starting with a letter`,
		);
	}
	if (name === TEST_STAGE) {
		problems.push(`stage "${TEST_STAGE}" is reserved for gkm test`);
	}
	return problems;
}

/** Everything wrong with a list of deployed stages on its own. */
export function deployedProblems(deployed: readonly string[]): string[] {
	const problems = deployed.flatMap(nameProblems);
	const seen = new Set<string>();
	for (const name of deployed) {
		if (seen.has(name)) problems.push(`stage "${name}" is listed twice`);
		seen.add(name);
	}
	return problems;
}

/** Everything wrong with a stages block, or nothing. */
export function stageProblems(stages: StagesConfig | undefined): string[] {
	if (!stages) {
		return [
			"`stages` is required, e.g. stages: { local: 'dev', deployed: ['prod'] }",
		];
	}

	const { local, deployed, protected: kept = [] } = stages;
	const problems = [...nameProblems(local), ...deployedProblems(deployed)];

	if (deployed.includes(local)) {
		problems.push(
			`"${local}" is both the local stage and a deployed one; they would share secrets`,
		);
	}

	for (const name of kept) {
		if (!deployed.includes(name)) {
			problems.push(`protected stage "${name}" is not a deployed stage`);
		}
	}

	return problems;
}

/** The stages block, or an error naming everything wrong with it. */
export function validateStages(stages: StagesConfig | undefined): StagesConfig {
	const problems = stageProblems(stages);
	if (problems.length) {
		throw new InvalidStages(problems);
	}
	return stages!;
}

/** Refuses a stage the project does not deploy to. */
export function assertDeployedStage(stages: StagesConfig, stage: string): void {
	if (!stages.deployed.includes(stage)) {
		throw new UndeclaredStage(stage, stages.deployed);
	}
}

/** A stages block — in gkm.config.ts or from `gkm init`'s flags — that breaks a rule. */
export class InvalidStages extends Error {
	constructor(readonly problems: readonly string[]) {
		super(`Invalid stages:\n  ${problems.join('\n  ')}`);
		this.name = 'InvalidStages';
	}
}

/**
 * A stage the project does not deploy to. Refused before anything is
 * provisioned, so a typo does not become a second environment.
 */
export class UndeclaredStage extends Error {
	constructor(
		readonly stage: string,
		readonly deployed: readonly string[],
	) {
		super(
			`"${stage}" is not a deployed stage. gkm.config.ts deploys to: ${deployed.join(', ') || 'nothing yet'}.`,
		);
		this.name = 'UndeclaredStage';
	}
}
