import { GkmError } from '../errors';
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
export class InvalidStages extends GkmError {
	constructor(readonly problems: readonly string[]) {
		super(`Invalid stages:\n  ${problems.join('\n  ')}`);
		this.name = 'InvalidStages';
	}
}

/**
 * A stage the project does not deploy to. Refused before anything is
 * provisioned, so a typo does not become a second environment.
 */
export class UndeclaredStage extends GkmError {
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

/**
 * A per-stage setting keyed by a stage the workspace does not deploy: a typo,
 * a stage since removed, or the local stage, which none of them apply to.
 */
export class UnknownStageKey extends GkmError {
	constructor(
		/** Where it is: `domains`, `deploy.objects`, `dns['example.com'].records.target`. */
		readonly setting: string,
		readonly stage: string,
		readonly deployed: readonly string[],
		readonly local?: string,
	) {
		super(
			`${setting} names the stage '${stage}', ` +
				(stage === local
					? `the local stage — ${setting} is read for deployed stages only. `
					: "which is not one of this workspace's deployed stages. ") +
				`It takes ${deployed.length > 0 ? deployed.map((s) => `'${s}'`).join(', ') : 'no stage: stages.deployed is empty'}` +
				' — the stages in stages.deployed.',
		);
		this.name = 'UnknownStageKey';
	}
}

/**
 * The first key of a per-stage map that is not a deployed stage.
 *
 * @throws {UnknownStageKey}
 */
export function assertDeployedStageKeys(
	setting: string,
	map: Readonly<Record<string, unknown>> | undefined,
	stages: { local?: string; deployed?: readonly string[] } | undefined,
): void {
	if (!map || !stages?.deployed) return;
	for (const key of Object.keys(map)) {
		if (!stages.deployed.includes(key)) {
			throw new UnknownStageKey(setting, key, stages.deployed, stages.local);
		}
	}
}
