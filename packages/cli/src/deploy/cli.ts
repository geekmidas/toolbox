/**
 * `gkm deploy`: the terminal around `deploy()`. CLI layer only.
 *
 * Everything that belongs to a person at a terminal lives here and nowhere
 * below it: prompting for a missing login (and storing it), printing progress,
 * and turning the outcome into an exit code. The deploy itself is the same
 * `deploy()` a host calls.
 */

import { formatError } from '../debug';
import { targetForProvider } from '../target/provider';
import { storedCredentials } from './credentials';
import { deploy } from './deploy';
import { type DevService, parseDevServices } from './devServices';
import { terminalCredentials } from './terminal';

export interface DeployCliOptions {
	/** The project directory: `--cwd`, else where the command was run. */
	cwd: string;
	/** `--target`: where to deploy. Defaults to `deploy.default`. */
	target?: string;
	/** `--provider`, deprecated: `dokploy` means `--target dokploy`. */
	provider?: string;
	stage: string;
	tag?: string;
	/**
	 * Print each event as one JSON object per line on stdout, instead of the
	 * progress lines. Nothing prompts: a missing credential fails the run.
	 */
	json?: boolean;
	/** Plan only: create, change, build and push nothing. */
	dryRun?: boolean;
	/** On a failed release, roll back every app, not only the failed ones. */
	atomic?: boolean;
	/** `--allow-dev-services minio,mailpit`, as typed. */
	allowDevServices?: string;
}

/** Where the command writes. The process's own streams, outside tests. */
export interface DeployCliStreams {
	stdout: Pick<NodeJS.WriteStream, 'write'>;
}

/**
 * Run `gkm deploy` and resolve with its exit code: 0 when the run finished,
 * 1 when anything stopped it.
 */
export async function deployCli(
	options: DeployCliOptions,
	streams: DeployCliStreams = { stdout: process.stdout },
): Promise<number> {
	let target = options.target;
	if (options.provider !== undefined && target === undefined) {
		try {
			// On stderr, so a `--json` run's stdout still carries only events.
			target = targetForProvider(options.provider, (message) =>
				console.warn(message),
			);
		} catch (error) {
			console.error(formatError(error));
			return 1;
		}
	}

	let allowDevServices: DevService[];
	try {
		allowDevServices = parseDevServices(options.allowDevServices);
	} catch (error) {
		console.error(formatError(error));
		return 1;
	}

	const input = {
		cwd: options.cwd,
		stage: options.stage,
		...(target ? { target } : {}),
		...(options.tag ? { tag: options.tag } : {}),
		...(options.dryRun ? { dryRun: true } : {}),
		...(options.atomic ? { atomic: true } : {}),
		...(allowDevServices.length > 0 ? { allowDevServices } : {}),
	};

	if (options.json) {
		// stdout carries the events and nothing else: docker's own output goes
		// to stderr, and nobody is asked anything — a prompt would be written
		// into the stream a program is parsing.
		const run = deploy({
			...input,
			credentials: storedCredentials(),
			childOutput: 'stderr',
		});
		for await (const event of run) {
			streams.stdout.write(`${JSON.stringify(event)}\n`);
		}
		return run.result.then(
			() => 0,
			(error) => {
				console.error(formatError(error));
				return 1;
			},
		);
	}

	// The lines arrive as they are written, rather than as events read back a
	// tick later, so they interleave with a prompt exactly as they always did.
	const run = deploy({
		...input,
		credentials: terminalCredentials(storedCredentials()),
		logger: {
			info: (message) => console.log(message),
			warn: (message) => console.warn(message),
			error: (message) => console.error(message),
		},
	});

	try {
		await run.result;
		return 0;
	} catch (error) {
		console.error(formatError(error));
		return 1;
	}
}
