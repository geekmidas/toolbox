/**
 * Who wrote a stage's deploy state: a GitHub Actions run, or a person at a
 * machine. Recorded on every state write (`updatedBy`), on every resource
 * record and on every release (`releasedBy`), so "who put this here" has an
 * answer that does not depend on anyone's memory.
 */

import { hostname, userInfo } from 'node:os';

/** A GitHub Actions run: the account that triggered it and the run's page. */
export interface GithubActor {
	kind: 'github';
	/** `GITHUB_ACTOR` — the account that triggered the run. */
	actor: string;
	/** `<server>/<repository>/actions/runs/<run id>` */
	run: string;
	/** `GITHUB_WORKFLOW` — the workflow's name. */
	workflow?: string;
}

/** A person at a machine. */
export interface LocalActor {
	kind: 'local';
	user: string;
	host: string;
}

export type Actor = GithubActor | LocalActor;

/** Whether `env` is a CI job — GitHub Actions or any runner that sets `CI`. */
export function isCi(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.GITHUB_ACTIONS === 'true' || env.CI === 'true';
}

/** Who this process is writing as. */
export function currentActor(env: NodeJS.ProcessEnv = process.env): Actor {
	if (env.GITHUB_ACTIONS === 'true') {
		const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
		return {
			kind: 'github',
			actor: env.GITHUB_ACTOR ?? 'unknown',
			run: `${server}/${env.GITHUB_REPOSITORY ?? 'unknown'}/actions/runs/${env.GITHUB_RUN_ID ?? 'unknown'}`,
			...(env.GITHUB_WORKFLOW ? { workflow: env.GITHUB_WORKFLOW } : {}),
		};
	}

	let user = 'unknown';
	try {
		user = userInfo().username;
	} catch {
		// No passwd entry (a container running as an arbitrary uid).
	}
	return { kind: 'local', user, host: hostname() };
}

/** `octocat (deploy, https://github.com/…/runs/1)` or `ada@laptop`. */
export function describeActor(actor: Actor | undefined): string {
	if (!actor) return 'unknown';
	if (actor.kind === 'local') return `${actor.user}@${actor.host}`;
	return `${actor.actor} (${actor.workflow ? `${actor.workflow}, ` : ''}${actor.run})`;
}
