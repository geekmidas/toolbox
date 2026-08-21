/**
 * What reconcile records, and the hash that lets it do nothing.
 *
 * Reconciling on every `gkm dev` is only acceptable if the converged case is
 * free, so the desired plan is hashed: matching hash plus healthy containers
 * means there is nothing to do. Without that, the automatic reconcile the design
 * asks for would tax every start.
 *
 * Almost nothing needs recording — roles are queried, migrations have their own
 * table, containers are remembered by Docker. Only ports and this hash have no
 * other owner.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ComposeFile } from './compose';
import type { Plan } from './plan';

/** What was true at the end of the last successful reconcile. */
export interface ReconcileState {
	/** The hash of the plan that was applied. */
	hash: string;
	/** The stage it was applied for, so a mismatched file is ignored. */
	stage: string;
}

const STATE_DIR = '.gkm/reconcile';

/**
 * The hash of everything a reconcile would act on.
 *
 * Covers the compose document rather than the plan alone, because the plan is
 * unchanged when only an image pin moves — and a changed image is exactly a
 * container that must be recreated. `stringify` is stable here because
 * `composeFor` sorts its containers, which is what makes the hash meaningful.
 *
 * Deliberately a plain function over serialisable input: the deployed target
 * keys its provisioner invocation on the same idea, and the two must not be able
 * to disagree about what counts as a change.
 */
export function planHash(plan: Plan, compose: ComposeFile): string {
	return createHash('sha256')
		.update(JSON.stringify({ stage: plan.stage, plan, compose }))
		.digest('hex');
}

/** Read the recorded state, or nothing if this stage has never reconciled. */
export async function loadState(
	root: string,
	stage: string,
): Promise<ReconcileState | undefined> {
	try {
		const raw = await readFile(statePath(root, stage), 'utf-8');
		const state = JSON.parse(raw) as ReconcileState;

		// A file written for another stage is not this stage's state. Treating it
		// as one is how `gkm test` would skip work `gkm dev` did.
		return state.stage === stage ? state : undefined;
	} catch {
		// Unreadable, absent, or corrupt all mean the same thing: reconcile. The
		// loop is convergent, so the cost of being wrong here is one slow start.
		return undefined;
	}
}

/** Record what was applied, so the next run can skip it. */
export async function saveState(
	root: string,
	state: ReconcileState,
): Promise<void> {
	const path = statePath(root, state.stage);

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

function statePath(root: string, stage: string): string {
	return join(root, STATE_DIR, `${stage}.json`);
}
