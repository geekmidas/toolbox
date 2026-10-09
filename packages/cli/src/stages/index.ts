/**
 * `gkm stages` — the workspace's stages, as gkm.config.ts declares them.
 *
 * ```bash
 * gkm stages                    # a table
 * gkm stages --json             # {"local":"dev","deployed":["prod"],"protected":["prod"]}
 * gkm stages --github-output    # a workflow run's build and deploy matrices
 * ```
 *
 * The config is read by the normal loader (and sandbox), so a workflow never
 * parses TypeScript to learn which stages exist. `--github-output` is what the
 * `geekmidas/toolbox/actions/stages` action runs: it writes the stages, and
 * which of them this run builds and deploys, to `$GITHUB_OUTPUT`.
 */

import { appendFile } from 'node:fs/promises';
import { stageDnsDomains } from '../compose/dns.js';
import { loadWorkspaceSettings } from '../config.js';
import { GkmError } from '../errors';
import { stageProvider } from '../providers/config.js';
import { PROVIDER_KINDS } from '../providers/types.js';
import type { NormalizedWorkspace, StagesConfig } from '../workspace/types.js';
import { planStages } from './plan.js';

export { DispatchNamesNoStage, type PlanInput, planStages } from './plan.js';

export interface StagesOptions {
	/** Print the stages as JSON. */
	json?: boolean;
	/** Write the outputs a deploy workflow reads to `$GITHUB_OUTPUT`. */
	githubOutput?: boolean;
	/** The event to plan for; defaults to `GITHUB_EVENT_NAME`. */
	event?: string;
	/** The stage a `workflow_dispatch` names. */
	stage?: string;
}

export interface StagesDeps {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	/** Where lines go; stdout by default. */
	log?: (line: string) => void;
}

/** The stages, as `gkm stages --json` prints them. */
export interface StagesJson {
	local: string;
	deployed: string[];
	protected: string[];
}

export function stagesJson(stages: StagesConfig): StagesJson {
	return {
		local: stages.local,
		deployed: [...stages.deployed],
		protected: [...(stages.protected ?? [])],
	};
}

/**
 * The region of the workspace's AWS secrets store — `ssm` or
 * `secrets-manager` — or `''` when its deployed stages keep their secrets
 * anywhere else. A job assumes the stage's AWS role only when this is set.
 */
export function awsSecretsRegion(workspace: NormalizedWorkspace): string {
	const store = workspace.secrets?.store;
	if (typeof store !== 'object' || store === null) return '';
	if (store.provider === 'ssm' || store.provider === 'secrets-manager') {
		return store.region;
	}
	return '';
}

/**
 * The deployed stages with resources the deploy creates — a provider under
 * `deploy.<kind>.<stage>`, or a domain under a `dns` entry whose provider
 * writes records — and secrets a CI runner can reach (an AWS store): a
 * compose deploy workflow creates their resources on the runner, with the
 * stage's role and DNS token, rather than on the server.
 */
export function resourceStages(workspace: NormalizedWorkspace): string[] {
	if (!awsSecretsRegion(workspace)) return [];
	return workspace.stages.deployed.filter(
		(stage) =>
			PROVIDER_KINDS.some(
				(kind) => stageProvider(workspace, kind, stage).mode === 'provider',
			) ||
			stageDnsDomains(stage, workspace.domains, workspace.dns).some(
				({ config }) => config.provider !== 'manual',
			),
	);
}

/**
 * Every output the stages action sets, each a string `fromJSON()` reads, for
 * one workflow run.
 */
export function githubOutputs(
	workspace: NormalizedWorkspace,
	input: { event: string; stage?: string },
): Record<string, string> {
	const stages = stagesJson(workspace.stages);
	const plan = planStages(workspace.stages, input);

	return {
		local: JSON.stringify(stages.local),
		deployed: JSON.stringify(stages.deployed),
		protected: JSON.stringify(stages.protected),
		build: JSON.stringify(plan.build),
		deploy: JSON.stringify(plan.deploy),
		// A matrix over an empty list is an error on GitHub, so a job over one
		// is skipped on these instead.
		'has-build': String(plan.build.length > 0),
		'has-deploy': String(plan.deploy.length > 0),
		'aws-region': awsSecretsRegion(workspace),
		resources: JSON.stringify(resourceStages(workspace)),
	};
}

/** `name=value` lines, as `$GITHUB_OUTPUT` takes single-line values. */
export function formatGithubOutputs(outputs: Record<string, string>): string {
	return Object.entries(outputs)
		.map(([name, value]) => `${name}=${value}\n`)
		.join('');
}

/** A message as a workflow command's data: GitHub reads `%`, CR and LF escaped. */
function workflowCommandData(message: string): string {
	return message
		.replaceAll('%', '%25')
		.replaceAll('\r', '%0D')
		.replaceAll('\n', '%0A');
}

function table(stages: StagesJson): string {
	const rows: [string, string][] = [
		['STAGE', 'KIND'],
		[stages.local, 'local'],
		...stages.deployed.map((name): [string, string] => [
			name,
			stages.protected.includes(name) ? 'deployed, protected' : 'deployed',
		]),
	];
	const width = Math.max(...rows.map(([name]) => name.length));
	return rows
		.map(([name, kind]) => `${name.padEnd(width)}  ${kind}`)
		.join('\n');
}

export async function stagesCommand(
	options: StagesOptions,
	deps: StagesDeps = {},
): Promise<void> {
	const env = deps.env ?? process.env;
	const log = deps.log ?? ((line: string) => console.log(line));

	if (!options.githubOutput) {
		const workspace = await loadWorkspaceSettings(deps.cwd);
		const stages = stagesJson(workspace.stages);
		log(options.json ? JSON.stringify(stages) : table(stages));
		return;
	}

	try {
		const file = env.GITHUB_OUTPUT;
		if (!file) throw new GithubOutputNotSet();

		const workspace = await loadWorkspaceSettings(deps.cwd);
		const event = options.event || env.GITHUB_EVENT_NAME;
		if (!event) throw new GithubEventNotSet();

		const outputs = githubOutputs(workspace, {
			event,
			...(options.stage ? { stage: options.stage } : {}),
		});
		await appendFile(file, formatGithubOutputs(outputs));

		log(`${event}: build ${outputs.build}, deploy ${outputs.deploy}`);
	} catch (error) {
		// Annotated on the run, where whoever started it looks first.
		const message = error instanceof Error ? error.message : String(error);
		log(`::error title=gkm stages::${workflowCommandData(message)}`);
		throw error;
	}
}

/** `--github-output` outside a GitHub Actions step, which sets the file. */
export class GithubOutputNotSet extends GkmError {
	constructor() {
		super(
			'gkm stages --github-output writes to the file GITHUB_OUTPUT names, and it is not set. Run it in a GitHub Actions step, or set GITHUB_OUTPUT to a file to write to.',
		);
		this.name = 'GithubOutputNotSet';
	}
}

/** No `--event`, and no `GITHUB_EVENT_NAME` to take it from. */
export class GithubEventNotSet extends GkmError {
	constructor() {
		super(
			'gkm stages --github-output plans for an event, and none was given. Pass --event (push, release, workflow_dispatch), or run it in a GitHub Actions step, which sets GITHUB_EVENT_NAME.',
		);
		this.name = 'GithubEventNotSet';
	}
}
