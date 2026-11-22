/**
 * The startup check (`gkm compose --stage <stage> --build --check`): every
 * image the build produced, started before anything is pushed.
 *
 * A bundle that builds, typechecks and passes every test can still fail to
 * start — a package that finds its own files at runtime, inlined into the
 * bundle and so not in the image's `node_modules`. Tests run from source,
 * where `node_modules` is, so the first place that shows is the server.
 *
 * So the images are started here, on the machine that built them, with a
 * deployed stage's real secrets — never fakes, which would prove only that
 * the image starts against the fakes — and the backing services the stack
 * declares (Postgres, Redis, …) started beside them, migrated. Each app,
 * worker and processor must pass its own health check, or the check fails
 * naming it, with its last log lines, and nothing is pushed.
 *
 * The stage is one that is not protected: a check runs on every pull request,
 * and a protected stage's secrets are not handed to one.
 */

import { GkmError } from '../../errors';
import type { NormalizedWorkspace } from '../../workspace/types';

/** How many of its last lines a container that failed the check is shown. */
export const CHECK_LOG_LINES = 50;

/** The compose project a stage's check runs as, never the stage's own. */
export function checkProject(project: string): string {
	return `${project}-check`;
}

/** `--check` with no build: there is nothing built here to start. */
export class StartupCheckNeedsBuild extends GkmError {
	constructor() {
		super(
			'--check starts the images this checkout builds, so it needs --build ' +
				'(and never --pull): gkm compose --stage <stage> --build --check.',
		);
		this.name = 'StartupCheckNeedsBuild';
	}
}

/** `--check` of a stage that is not deployed: it has no real secrets. */
export class StartupCheckNeedsDeployedStage extends GkmError {
	constructor(
		readonly stage: string,
		readonly deployed: readonly string[],
	) {
		super(
			`'${stage}' is not a deployed stage, and a startup check runs with a ` +
				`deployed stage's real secrets. Check one of the deployed stages that ` +
				`is not protected: ${deployed.join(', ') || '(none is declared)'}.`,
		);
		this.name = 'StartupCheckNeedsDeployedStage';
	}
}

/** `--check` of a protected stage, whose secrets a check is never given. */
export class StartupCheckStageProtected extends GkmError {
	constructor(
		readonly stage: string,
		/** The deployed stages that are not protected — the ones to check. */
		readonly checkable: readonly string[],
	) {
		super(
			`'${stage}' is protected (stages.protected), and a startup check is ` +
				`never given a protected stage's secrets: it runs on every pull ` +
				`request. ` +
				(checkable.length > 0
					? `Check ${checkable.map((s) => `'${s}'`).join(' or ')} instead.`
					: 'Declare a deployed stage that is not protected, and check that.'),
		);
		this.name = 'StartupCheckStageProtected';
	}
}

/** Images that did not start: each one, what Docker said, and its logs. */
export class StartupCheckFailed extends GkmError {
	constructor(
		readonly stage: string,
		readonly apps: readonly {
			app: string;
			/** Its health as Docker reports it — `unhealthy`, `not running`. */
			last: string;
			/** Its last {@link CHECK_LOG_LINES} lines of output. */
			logs: string;
		}[],
	) {
		const one = apps.length === 1;
		super(
			`${one ? 'This image' : 'These images'} did not start with '${stage}''s ` +
				`secrets, so nothing was pushed:\n` +
				apps
					.map(
						({ app, last, logs }) =>
							`  - ${app}: Docker reports it ${last}` +
							(logs
								? `. Its last lines:\n${logs
										.split('\n')
										.map((line) => `      ${line}`)
										.join('\n')}`
								: ', and it logged nothing.'),
					)
					.join('\n') +
				`\nA package that reads its own files at runtime is bundled ` +
				`without them: run the image with \`gkm compose --stage ${stage} ` +
				`--build --check\` until ${one ? 'it starts' : 'they start'}.`,
		);
		this.name = 'StartupCheckFailed';
	}
}

/**
 * Refuse a check gkm cannot run honestly: one that builds nothing, of a stage
 * with no real secrets, or of a protected stage.
 */
export function assertCheckable(
	workspace: Pick<NormalizedWorkspace, 'stages'>,
	stage: string,
	mode: 'build' | 'pull' | undefined,
): void {
	if (mode !== 'build') throw new StartupCheckNeedsBuild();
	const { deployed, protected: kept = [] } = workspace.stages;
	const checkable = deployed.filter((name) => !kept.includes(name));
	if (!deployed.includes(stage)) {
		throw new StartupCheckNeedsDeployedStage(stage, checkable);
	}
	if (kept.includes(stage)) {
		throw new StartupCheckStageProtected(stage, checkable);
	}
}
