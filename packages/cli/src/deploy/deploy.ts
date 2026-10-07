/**
 * `deploy()`: a deploy as a library call.
 *
 * `gkm deploy` could only be driven from an interactive terminal: it prompted
 * for what it lacked and exited the process on failure, worked out of
 * `process.cwd()`, and reported progress by printing. Here the caller says
 * where the project is, hands over the credentials and a signal, and gets back
 * a run — events to iterate while it goes, and a structured result at the end.
 * Nothing below this asks a person anything or ends the process; `gkm deploy`
 * is a thin wrapper that does both.
 */

import { resolve } from 'node:path';
import { loadWorkspaceConfig } from '../config';
import { gkmHome } from '../home';
import { type OutputLevel, withOutput } from '../output';
import type { RunOptions } from '../run';
import { assertDeployedStage } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { type CredentialProvider, storedCredentials } from './credentials';
import { type DeployEvent, eventError } from './events';
import { type DeployContext, runDeploy } from './index';
import type { DeployResult } from './types';

/**
 * Where a run's progress lines go, besides its events. `@geekmidas/logger`'s
 * `Logger` is one.
 */
export interface DeployLogger {
	info(message: string): void;
	warn(message: string): void;
	error?(message: string): void;
}

export interface DeployInput {
	/**
	 * The project to deploy: the directory holding `gkm.config.ts`, or any
	 * directory inside it. Never assumed to be `process.cwd()`.
	 */
	cwd: string;
	/** The stage to deploy — one of the config's deployed stages. */
	stage: string;
	/** The image tag. Defaults to `<stage>-<timestamp>`. */
	tag?: string;
	/** Deploy only these apps (in dependency order). Defaults to all. */
	apps?: string[];
	/**
	 * Look everything up and report what would happen — as `resource.planned`
	 * events — without taking the lock, writing state, generating secrets,
	 * changing Dokploy or building and pushing images.
	 */
	dryRun?: boolean;
	/**
	 * Where credentials come from. Defaults to the environment, then the
	 * logins `gkm login` stored. A credential no provider has stops the run
	 * with `MissingCredential`; nothing prompts.
	 */
	credentials?: CredentialProvider;
	/** Receives each progress line as it is written. Defaults to none. */
	logger?: DeployLogger;
	/**
	 * Stops the run: in-flight Dokploy requests and docker children are
	 * cancelled, the stage's lock is released, and `result` rejects with the
	 * signal's reason.
	 */
	signal?: AbortSignal;
	/**
	 * The CLI's home: stage keys and stored logins. Defaults to `GKM_HOME`,
	 * else `~/.gkm`.
	 */
	home?: string;
	/**
	 * Where docker's own output goes: the host's terminal (`inherit`, the
	 * default), its stderr, or nowhere.
	 */
	childOutput?: 'inherit' | 'stderr' | 'ignore';
}

/** A deploy in progress. */
export interface DeployRun extends AsyncIterable<DeployEvent> {
	/**
	 * What the deploy did, once it is done. Rejects with the error that
	 * stopped it — `MissingCredential`, `StateLocked`, `ProjectNotOwned`, … —
	 * after a `deploy.failed` event carrying the same.
	 */
	readonly result: Promise<DeployResult>;
}

/**
 * Every event a run emits, kept so that each iteration — however late it
 * starts — sees the run from its first event to its last.
 */
class EventLog {
	private readonly events: DeployEvent[] = [];
	private closed = false;
	private waiting: (() => void)[] = [];

	push(event: DeployEvent): void {
		this.events.push(event);
		this.wake();
	}

	close(): void {
		this.closed = true;
		this.wake();
	}

	private wake(): void {
		const waiting = this.waiting;
		this.waiting = [];
		for (const resume of waiting) resume();
	}

	async *iterate(): AsyncGenerator<DeployEvent> {
		let next = 0;
		while (true) {
			if (next < this.events.length) {
				yield this.events[next++]!;
			} else if (this.closed) {
				return;
			} else {
				await new Promise<void>((resume) => this.waiting.push(resume));
			}
		}
	}
}

/** `childOutput` as `spawn` reads it, where it is not the default. */
const CHILD_STDIO: Record<'stderr' | 'ignore', RunOptions['stdio']> = {
	stderr: ['ignore', 2, 2],
	ignore: 'ignore',
};

function forward(
	logger: DeployLogger | undefined,
	level: OutputLevel,
	message: string,
): void {
	if (!logger) return;
	if (level === 'info') logger.info(message);
	else if (level === 'error' && logger.error) logger.error(message);
	else logger.warn(message);
}

/**
 * Deploy a project's stage.
 *
 * ```ts
 * import { deploy } from '@geekmidas/cli/deploy';
 *
 * const run = deploy({ cwd: '/srv/checkouts/shop', stage: 'production' });
 * for await (const event of run) {
 *   if (event.type === 'app.deployed') console.log(event.app, event.url);
 * }
 * const result = await run.result;
 * ```
 *
 * The run starts at once; iterating it is optional, and an iteration started
 * late still sees every event from the first.
 */
export function deploy(input: DeployInput): DeployRun {
	const log = new EventLog();
	const emit = (event: DeployEvent) => {
		log.push(event);
		if (event.type === 'log') forward(input.logger, event.level, event.message);
	};

	const ctx: DeployContext = {
		emit,
		credentials:
			input.credentials ?? storedCredentials({ home: input.home ?? gkmHome() }),
		dryRun: input.dryRun ?? false,
		home: input.home ?? gkmHome(),
		...(input.signal ? { signal: input.signal } : {}),
		...(input.childOutput && input.childOutput !== 'inherit'
			? { stdio: CHILD_STDIO[input.childOutput] }
			: {}),
	};

	// Every line anything in the run writes through `output` — the deploy's
	// own, the Dockerfile generator's, discovery's warnings — becomes an event
	// of this run, and of no other.
	const result = withOutput(
		(level, message) => emit({ type: 'log', level, message }),
		async () => {
			try {
				input.signal?.throwIfAborted();
				const deployed = await runDeploy(
					() => load(input),
					{
						stage: input.stage,
						...(input.tag ? { tag: input.tag } : {}),
						...(input.apps ? { apps: input.apps } : {}),
					},
					ctx,
				);
				emit({ type: 'deploy.finished', result: deployed });
				return deployed;
			} catch (error) {
				emit({ type: 'deploy.failed', error: eventError(error) });
				throw error;
			} finally {
				log.close();
			}
		},
	);

	// A caller that only iterates still learns of the failure from the
	// `deploy.failed` event; the rejection must not also crash its process as
	// unhandled. Awaiting `result` still rejects.
	result.catch(() => {});

	return {
		result,
		[Symbol.asyncIterator]: () => log.iterate(),
	};
}

/** The workspace at `input.cwd`, refusing a stage it does not deploy. */
async function load(input: DeployInput): Promise<NormalizedWorkspace> {
	const { workspace } = await loadWorkspaceConfig(resolve(input.cwd));

	// Before anything is provisioned: a typo'd stage would otherwise create a
	// whole second environment under the wrong name.
	assertDeployedStage(workspace.stages, input.stage);
	return workspace;
}
