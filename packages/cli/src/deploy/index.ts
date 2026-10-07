/**
 * Deploy Module
 *
 * The Dokploy engine moved under `target/dokploy/`, beside the target that
 * runs it; it is re-exported here for one alpha. What stays is the command
 * as it was called before `deploy()`.
 *
 * @module deploy
 */

import { loadWorkspaceConfig } from '../config';
import { targetForProvider } from '../target/provider';
import { assertDeployedStage } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { runDeploy } from './orchestrate';
import { terminalCredentials } from './terminal';
import type { DeployOptions, DeployProvider, DeployResult } from './types';

/** @deprecated Import from `target/dokploy/engine`. Kept for one alpha. */
export * from '../target/dokploy/engine';

/**
 * Deploy a loaded workspace, printing to the terminal and prompting for
 * missing credentials there.
 *
 * @deprecated Use `deploy({ cwd, stage })` from `@geekmidas/cli/deploy`,
 * which never prompts or prints and reports progress as events. This wrapper
 * is kept for one alpha.
 */
export async function workspaceDeployCommand(
	workspace: NormalizedWorkspace,
	options: DeployOptions,
): Promise<DeployResult> {
	// Quietly: the deprecation is the flag's, and this function is itself the
	// deprecated way in.
	const target = targetForProvider(options.provider, () => {});

	// No sink: `output` falls back to the console, which is what this always
	// printed to.
	return runDeploy(
		workspace,
		{
			stage: options.stage,
			target,
			...(options.tag ? { tag: options.tag } : {}),
			...(options.apps ? { apps: options.apps } : {}),
		},
		{
			emit: () => {},
			credentials: terminalCredentials(),
			dryRun: false,
		},
	);
}

/**
 * Deploy the workspace in the current directory.
 *
 * @deprecated Use `deploy({ cwd: process.cwd(), stage })` from
 * `@geekmidas/cli/deploy`. Kept for one alpha.
 */
export async function deployCommand(
	options: DeployOptions,
): Promise<DeployResult> {
	// Load config with workspace detection
	const loadedConfig = await loadWorkspaceConfig();

	// Before anything is provisioned: a typo'd stage would otherwise create a
	// whole second environment under the wrong name.
	assertDeployedStage(loadedConfig.workspace.stages, options.stage);

	// One path, whatever the config was written as.
	//
	// `defineConfig` is sugar over a one-app workspace, and `processConfig`
	// already projects it into the same `NormalizedWorkspace` a `defineWorkspace`
	// produces — so branching here meant a single-app project silently got less.
	// Domains were the clearest case: `createDomain` is only reached from this
	// function, so a single-app deploy provisioned everything, pushed an image,
	// started a container, and left nothing routing to it.
	return workspaceDeployCommand(loadedConfig.workspace, options);
}

export type { DeployOptions, DeployProvider, DeployResult };
