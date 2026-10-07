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
import { findWorkspaceRoot, loadWorkspaceConfig } from '../config';
import { gkmHome } from '../home';
import { type OutputLevel, withOutput } from '../output';
import type { RunOptions } from '../run';
import { LocalSandbox } from '../sandbox/local';
import { type Sandbox, withSandbox } from '../sandbox/sandbox';
import { Redactor } from '../target/secrets';
import type { AnyDeployTarget } from '../target/types';
import { assertDeployedStage } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { type CredentialProvider, storedCredentials } from './credentials';
import { type DeployEvent, eventError } from './events';
import { type DeployContext, runDeploy } from './orchestrate';
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
	/**
	 * The target to deploy through, by name. Defaults to `deploy.default`,
	 * else `dokploy`.
	 */
	target?: string;
	/**
	 * The host's own targets, by name. Consulted before the built-ins and the
	 * config's `deploy.targets`, so a host can deploy through an
	 * implementation of its own — `{ dokploy: myDokploy }` included.
	 */
	targets?: Record<string, AnyDeployTarget>;
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
	/**
	 * Where the project's own code runs: loading `gkm.config.ts`, discovering
	 * its constructs, sniffing each app's environment. Defaults to a
	 * `LocalSandbox` on the project — a child process here with an
	 * allowlisted environment, for a project the host trusts.
	 *
	 * A host deploying repositories it does not trust passes one that
	 * isolates — a container per build — and the config then reaches the
	 * deploy only as data. Credentials never enter a sandbox: they go from
	 * `credentials` to the steps that provision, push and release.
	 */
	sandbox?: Sandbox;
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
	// Every secret the run reads is masked in every line it reports — in the
	// events and in what the logger is handed.
	const redactor = new Redactor();
	const emit = (event: DeployEvent) => {
		const masked =
			event.type === 'log'
				? { ...event, message: redactor.redact(event.message) }
				: event;
		log.push(masked);
		if (masked.type === 'log') {
			forward(input.logger, masked.level, masked.message);
		}
	};

	const ctx: DeployContext = {
		emit,
		credentials:
			input.credentials ?? storedCredentials({ home: input.home ?? gkmHome() }),
		dryRun: input.dryRun ?? false,
		home: input.home ?? gkmHome(),
		redactor,
		...(input.signal ? { signal: input.signal } : {}),
		...(input.childOutput ? { childOutput: input.childOutput } : {}),
		...(input.targets ? { targets: input.targets } : {}),
	};

	// Every line anything in the run writes through `output` — the deploy's
	// own, the Dockerfile generator's, discovery's warnings — becomes an event
	// of this run, and of no other.
	const result = withOutput(
		(level, message) => emit({ type: 'log', level, message }),
		async () => {
			try {
				input.signal?.throwIfAborted();
				const sandbox =
					input.sandbox ??
					new LocalSandbox({ root: findWorkspaceRoot(resolve(input.cwd)) });
				// Every step of the run that executes the project's code — the
				// engine's own discoveries and sniffs included — runs in it.
				const deployed = await withSandbox(sandbox, () =>
					runDeploy(
						() => load(input, sandbox),
						{
							stage: input.stage,
							...(input.target ? { target: input.target } : {}),
							...(input.tag ? { tag: input.tag } : {}),
							...(input.apps ? { apps: input.apps } : {}),
						},
						ctx,
					),
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
async function load(
	input: DeployInput,
	sandbox: Sandbox,
): Promise<NormalizedWorkspace> {
	const { workspace } = await loadWorkspaceConfig(resolve(input.cwd), {
		sandbox,
	});

	// Before anything is provisioned: a typo'd stage would otherwise create a
	// whole second environment under the wrong name.
	assertDeployedStage(workspace.stages, input.stage);
	return workspace;
}
