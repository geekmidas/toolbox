/**
 * `gkm provision`: the terminal around `runProvision`. CLI layer only.
 *
 * Run the way `deploy()` runs: the config loaded here, with the environment
 * the command was run in, and the project's code — discovery — in the
 * sandbox. Progress lines go to the terminal, or each event as a JSON line
 * with `--json`, where nothing prompts.
 */

import { resolve } from 'node:path';
import {
	findWorkspaceRoot,
	loadRawWorkspaceConfig,
	loadWorkspaceConfig,
	withLoadedConfig,
} from '../config';
import { formatError } from '../debug';
import { gkmHome } from '../home';
import { withOutput } from '../output';
import { LocalSandbox } from '../sandbox/local';
import { type Sandbox, withSandbox } from '../sandbox/sandbox';
import { Redactor } from '../target/secrets';
import { type CredentialProvider, storedCredentials } from './credentials';
import { eventError } from './events';
import {
	type ProvisionEvent,
	type ProvisionResult,
	runProvision,
} from './provision';
import { terminalCredentials } from './terminal';

export interface ProvisionCliOptions {
	/** The project directory: `--cwd`, else where the command was run. */
	cwd: string;
	stage: string;
	/** Each event as one JSON object per line on stdout; never prompts. */
	json?: boolean;
	/** Plan only: create, change and write nothing. */
	dryRun?: boolean;
	/** `--rotate-keys`. */
	rotateKeys?: boolean;
	/** `--retire-old-keys`. */
	retireOldKeys?: boolean;
	/** `--profile`: the AWS profile for the stage's account. */
	profile?: string;
	/** `--project`: the Google Cloud project for the stage's Google providers. */
	project?: string;
}

/** Where the command writes, and what it runs with. Overridden in tests. */
export interface ProvisionCliDeps {
	stdout: Pick<NodeJS.WriteStream, 'write'>;
	credentials?: CredentialProvider;
	sandbox?: Sandbox;
	home?: string;
}

/**
 * Run `gkm provision` and resolve with its exit code: 0 when the run
 * finished, 1 when anything stopped it.
 */
export async function provisionCli(
	options: ProvisionCliOptions,
	deps: ProvisionCliDeps = { stdout: process.stdout },
): Promise<number> {
	const cwd = resolve(options.cwd);
	let config: Awaited<ReturnType<typeof loadRawWorkspaceConfig>>['config'];
	try {
		({ config } = await loadRawWorkspaceConfig(cwd));
	} catch (error) {
		console.error(formatError(error));
		return 1;
	}

	const home = deps.home ?? gkmHome();
	const stored =
		deps.credentials ??
		storedCredentials({
			home,
			...(options.profile ? { profile: options.profile } : {}),
		});
	const redactor = new Redactor();
	const emit = (event: ProvisionEvent): void => {
		const masked =
			event.type === 'log'
				? { ...event, message: redactor.redact(event.message) }
				: event;
		if (options.json) {
			deps.stdout.write(`${JSON.stringify(masked)}\n`);
			return;
		}
		if (masked.type !== 'log') return;
		if (masked.level === 'info') console.log(masked.message);
		else if (masked.level === 'warn') console.warn(masked.message);
		else console.error(masked.message);
	};

	try {
		const root = findWorkspaceRoot(cwd);
		const sandbox = deps.sandbox ?? new LocalSandbox({ root });
		const result: ProvisionResult = await withOutput(
			(level, message) => emit({ type: 'log', level, message }),
			() =>
				withLoadedConfig(root, config, () =>
					withSandbox(sandbox, () =>
						runProvision(
							async () =>
								(await loadWorkspaceConfig(cwd, { sandbox })).workspace,
							{
								stage: options.stage,
								...(options.rotateKeys ? { rotateKeys: true } : {}),
								...(options.retireOldKeys ? { retireOldKeys: true } : {}),
								...(options.project ? { project: options.project } : {}),
							},
							{
								emit,
								// A terminal is asked for a missing login; a JSON run is not.
								credentials: options.json
									? stored
									: terminalCredentials(stored),
								dryRun: options.dryRun === true,
								home,
								...(options.profile ? { profile: options.profile } : {}),
								redactor,
							},
						),
					),
				),
		);
		emit({ type: 'provision.finished', result });
		if (!options.json) {
			emit({
				type: 'log',
				level: 'info',
				message: provisionedLine(result),
			});
		}
		return 0;
	} catch (error) {
		emit({ type: 'provision.failed', error: eventError(error) });
		console.error(formatError(error));
		return 1;
	}
}

/** The run's last line: what it did, in one sentence. */
export function provisionedLine(result: ProvisionResult): string {
	const providers = result.reports.filter((r) => r.mode === 'provider');
	if (providers.length === 0) {
		return `\n✅ '${result.stage}' names no provider: nothing to provision.`;
	}
	const changes = providers.reduce((n, r) => n + r.actions.length, 0);
	const names = providers.map((r) => `${r.kind}: ${r.provider}`).join(', ');
	return result.dryRun
		? `\n📋 Dry run of '${result.stage}' (${names}): ${changes} change${changes === 1 ? '' : 's'} planned, nothing written.`
		: `\n✅ '${result.stage}' provisioned (${names}): ${changes} change${changes === 1 ? '' : 's'}.`;
}
