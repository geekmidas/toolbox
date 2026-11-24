/**
 * Which Google Cloud project a stage's Google provider works in, and the
 * record that keeps it there.
 *
 * `--project` wins, then the stage's own `deploy.<kind>.<stage>.project`,
 * then `<workspace>-<stage>`. The first run records the project in the
 * stage's state; a later run that resolves another one stops rather than
 * create a second set of resources somewhere else — a forgotten `--project`,
 * or one meant for another stage, is caught before anything is made.
 */

import { GkmError } from '../../errors';
import type { ProviderKind, ProvisionState } from '../types.js';
import { assertGoogleId } from './resources.js';

/** A later run resolved a different project than the stage recorded. */
export class GoogleProjectChanged extends GkmError {
	constructor(
		readonly stage: string,
		readonly kind: ProviderKind,
		readonly recorded: string,
		readonly requested: string,
	) {
		super(
			`'${stage}' keeps its ${kind} in the Google Cloud project '${recorded}', ` +
				`and this run would use '${requested}'. Deploy with --project ${recorded}, ` +
				`or set deploy.${kind}.${stage}.project to it. To move the stage, ` +
				'remove the google-project record with gkm state:pull/state:push first.',
		);
		this.name = 'GoogleProjectChanged';
	}
}

/** `<workspace>-<stage>`, as a project id Google accepts. */
export function defaultGoogleProject(workspace: string, stage: string): string {
	const clean = (value: string) =>
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	const base = clean(workspace).replace(/^[^a-z]+/, '');
	const suffix = `-${clean(stage)}`.slice(0, 15);
	return `${base.slice(0, 30 - suffix.length).replace(/-+$/, '')}${suffix}`;
}

/**
 * The project a stage's Google provider uses.
 *
 * @throws {GoogleIdInvalid} when the resolved id is not one Google accepts
 */
export function googleProject(input: {
	/** `--project`. */
	flag?: string | undefined;
	/** `deploy.<kind>.<stage>.project`. */
	configured?: string | undefined;
	workspace: string;
	stage: string;
}): string {
	const project =
		input.flag ??
		input.configured ??
		defaultGoogleProject(input.workspace, input.stage);
	assertGoogleId('project', project);
	return project;
}

/** The state key a kind's project is recorded under. */
export function googleProjectKey(kind: ProviderKind): string {
	return `google-project:${kind}`;
}

/**
 * Holds `kind` on `stage` to `project`: recorded on the first run, checked
 * on every later one. Run inside a provider's `ensure()` before it creates
 * anything; a dry run checks and records nothing.
 *
 * @throws {GoogleProjectChanged}
 */
export async function holdGoogleProject(
	state: Pick<ProvisionState, 'record' | 'pending' | 'ready'>,
	input: {
		stage: string;
		kind: ProviderKind;
		project: string;
		dryRun?: boolean;
	},
): Promise<void> {
	const key = googleProjectKey(input.kind);
	const recorded = state.record(key)?.id;
	if (recorded !== undefined && recorded !== input.project) {
		throw new GoogleProjectChanged(
			input.stage,
			input.kind,
			recorded,
			input.project,
		);
	}
	if (recorded !== undefined || input.dryRun) return;
	const entry = { key, type: 'google-project' };
	await state.pending(entry);
	await state.ready(entry, input.project);
}

/**
 * A deploy from CI found no project to work in. CI never creates one: its
 * identity is granted roles in a project that already exists, by
 * `gkm deploy:github`.
 */
export class GoogleProjectNotCreated extends GkmError {
	constructor(
		readonly stage: string,
		readonly kind: ProviderKind,
		readonly project: string,
	) {
		super(
			`'${stage}' keeps its ${kind} in the Google Cloud project '${project}', ` +
				"and it does not exist, or this deploy's account cannot see it. A " +
				`deploy from CI never creates a project: run gkm deploy --stage ${stage} ` +
				'once from a terminal, signed in as someone who can create one, then ' +
				`gkm deploy:github --stage ${stage}.`,
		);
		this.name = 'GoogleProjectNotCreated';
	}
}
