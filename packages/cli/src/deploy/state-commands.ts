/**
 * State Management CLI Commands
 *
 * Commands for managing deployment state across local and remote providers.
 */

import { loadWorkspaceConfig } from '../config';
import { CachedStateProvider } from './CachedStateProvider';
import { createStateProvider } from './StateProvider';
import type { DokployStageState } from './state';

export interface StateCommandOptions {
	stage: string;
}

/**
 * Pull state from remote to local.
 * `gkm state:pull --stage=<stage>`
 */
export async function statePullCommand(
	options: StateCommandOptions,
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();

	if (!workspace.state || workspace.state.provider === 'local') {
		console.error('No remote state provider configured.');
		console.error('Add a remote provider in gkm.config.ts:');
		console.error('  state: { provider: "ssm", region: "us-east-1" }');
		process.exit(1);
	}

	const provider = await createStateProvider({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

	if (!(provider instanceof CachedStateProvider)) {
		console.error('State provider does not support pull operation.');
		process.exit(1);
	}

	console.log(`Pulling state for stage: ${options.stage}...`);
	const state = await provider.pull(options.stage);

	if (state) {
		console.log('State pulled successfully.');
		printStateSummary(state);
	} else {
		console.log('No remote state found for this stage.');
	}
}

/**
 * Push local state to remote.
 * `gkm state:push --stage=<stage>`
 */
export async function statePushCommand(
	options: StateCommandOptions,
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();

	if (!workspace.state || workspace.state.provider === 'local') {
		console.error('No remote state provider configured.');
		console.error('Add a remote provider in gkm.config.ts:');
		console.error('  state: { provider: "ssm", region: "us-east-1" }');
		process.exit(1);
	}

	const provider = await createStateProvider({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

	if (!(provider instanceof CachedStateProvider)) {
		console.error('State provider does not support push operation.');
		process.exit(1);
	}

	console.log(`Pushing state for stage: ${options.stage}...`);
	const state = await provider.push(options.stage);

	if (state) {
		console.log('State pushed successfully.');
		printStateSummary(state);
	} else {
		console.log('No local state found for this stage.');
	}
}

/**
 * Show current state.
 * `gkm state:show --stage=<stage>`
 */
export async function stateShowCommand(
	options: StateCommandOptions & { json?: boolean },
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();

	const provider = await createStateProvider({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

	const state = await provider.read(options.stage);

	if (!state) {
		console.log(`No state found for stage: ${options.stage}`);
		return;
	}

	if (options.json) {
		console.log(JSON.stringify(state, null, 2));
	} else {
		printStateDetails(state);
	}
}

/**
 * Compare local and remote state.
 * `gkm state:diff --stage=<stage>`
 */
export async function stateDiffCommand(
	options: StateCommandOptions,
): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();

	if (!workspace.state || workspace.state.provider === 'local') {
		console.error('No remote state provider configured.');
		console.error('Diff requires a remote provider to compare against.');
		process.exit(1);
	}

	const provider = await createStateProvider({
		config: workspace.state,
		workspaceRoot: workspace.root,
		workspaceName: workspace.name,
	});

	if (!(provider instanceof CachedStateProvider)) {
		console.error('State provider does not support diff operation.');
		process.exit(1);
	}

	console.log(`Comparing state for stage: ${options.stage}...\n`);
	const { local, remote } = await provider.diff(options.stage);

	if (!local && !remote) {
		console.log('No state found (local or remote).');
		return;
	}

	if (!local) {
		console.log('Local:  (none)');
	} else {
		console.log(`Local:  Last deployed ${local.lastDeployedAt}`);
	}

	if (!remote) {
		console.log('Remote: (none)');
	} else {
		console.log(`Remote: Last deployed ${remote.lastDeployedAt}`);
	}

	console.log('');

	// Compare applications
	const localApps = local?.applications ?? {};
	const remoteApps = remote?.applications ?? {};
	const allApps = new Set([
		...Object.keys(localApps),
		...Object.keys(remoteApps),
	]);

	if (allApps.size > 0) {
		console.log('Applications:');
		for (const app of allApps) {
			const localId = localApps[app];
			const remoteId = remoteApps[app];

			if (localId === remoteId) {
				console.log(`  ${app}: ${localId ?? '(none)'}`);
			} else if (!localId) {
				console.log(`  ${app}: (none) -> ${remoteId} [REMOTE ONLY]`);
			} else if (!remoteId) {
				console.log(`  ${app}: ${localId} -> (none) [LOCAL ONLY]`);
			} else {
				console.log(
					`  ${app}: ${localId} (local) != ${remoteId} (remote) [MISMATCH]`,
				);
			}
		}
	}

	// Compare services
	const localServices = local?.services ?? {};
	const remoteServices = remote?.services ?? {};

	if (
		Object.keys(localServices).length > 0 ||
		Object.keys(remoteServices).length > 0
	) {
		console.log('\nServices:');
		const serviceKeys = new Set([
			...Object.keys(localServices),
			...Object.keys(remoteServices),
		]);

		for (const key of serviceKeys) {
			const localVal = localServices[key as keyof typeof localServices];
			const remoteVal = remoteServices[key as keyof typeof remoteServices];

			if (localVal === remoteVal) {
				console.log(`  ${key}: ${localVal ?? '(none)'}`);
			} else {
				console.log(
					`  ${key}: ${localVal ?? '(none)'} (local) != ${remoteVal ?? '(none)'} (remote)`,
				);
			}
		}
	}
}

function printStateSummary(state: DokployStageState): void {
	const appCount = Object.keys(state.applications).length;
	const hasPostgres = !!state.services.postgresId;
	const hasRedis = !!state.services.redisId;

	console.log(`  Stage: ${state.stage}`);
	console.log(`  Applications: ${appCount}`);
	console.log(`  Postgres: ${hasPostgres ? 'configured' : 'none'}`);
	console.log(`  Redis: ${hasRedis ? 'configured' : 'none'}`);
	console.log(`  Last deployed: ${state.lastDeployedAt}`);
}

function printStateDetails(state: DokployStageState): void {
	console.log(`Stage: ${state.stage}`);
	console.log(`Environment ID: ${state.environmentId}`);
	console.log(`Last Deployed: ${state.lastDeployedAt}`);
	console.log('');

	console.log('Applications:');
	const apps = Object.entries(state.applications);
	if (apps.length === 0) {
		console.log('  (none)');
	} else {
		for (const [name, id] of apps) {
			console.log(`  ${name}: ${id}`);
		}
	}
	console.log('');

	console.log('Services:');
	if (!state.services.postgresId && !state.services.redisId) {
		console.log('  (none)');
	} else {
		if (state.services.postgresId) {
			console.log(`  Postgres: ${state.services.postgresId}`);
		}
		if (state.services.redisId) {
			console.log(`  Redis: ${state.services.redisId}`);
		}
	}

	if (state.dnsVerified && Object.keys(state.dnsVerified).length > 0) {
		console.log('');
		console.log('DNS Verified:');
		for (const [hostname, info] of Object.entries(state.dnsVerified)) {
			console.log(`  ${hostname}: ${info.serverIp} (${info.verifiedAt})`);
		}
	}
}
