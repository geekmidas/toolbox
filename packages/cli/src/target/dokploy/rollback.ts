/**
 * `gkm deploy:rollback`: a stage's apps put back on the release before the
 * one they run, by hand — for a release that passed its checks and turned out
 * wrong anyway.
 *
 * One app by default, because an app is what usually broke: rolling the API
 * back over a site fix that shipped beside it undoes the fix too. `atomic`
 * rolls back every app that has a release to go back to, for apps that only
 * work together — an API and the site built against its newer contract.
 *
 * It restores images and nothing else. The environment an app runs with is
 * the stage's, resolved on every deploy, and migrations are forward-only: a
 * migration that the older code cannot run against is undone by a new
 * migration, never by a rollback.
 */

import { resolve } from 'node:path';
import { findWorkspaceRoot, loadWorkspaceConfig } from '../../config';
import {
	type CredentialProvider,
	storedCredentials,
} from '../../deploy/credentials';
import { DeployJournal } from '../../deploy/journal';
import {
	assertStateOutlivesRun,
	createStateStore,
} from '../../deploy/StateStore';
import {
	asDokployState,
	createEmptyState,
	type ReleasedImage,
	recordRollback,
} from '../../deploy/state';
import { GkmError } from '../../errors';
import { LocalSandbox } from '../../sandbox/local';
import { type Sandbox, withSandbox } from '../../sandbox/sandbox';
import { assertDeployedStage } from '../../workspace/stages';
import { dokployApi, restoreImage, verifySettings } from './engine';

export interface RollbackInput {
	/** The project: the directory holding `gkm.config.ts`, or one inside it. */
	cwd: string;
	stage: string;
	/** The app to roll back. */
	app?: string;
	/** Every app with an earlier release, instead of one. */
	atomic?: boolean;
	/** Defaults to the environment, then the logins `gkm login` stored. */
	credentials?: CredentialProvider;
	signal?: AbortSignal;
	/** Each progress line. Defaults to none. */
	log?: (line: string) => void;
	/** Where the config is loaded. Defaults to a `LocalSandbox` on the project. */
	sandbox?: Sandbox;
}

/** One app rolled back. */
export interface RolledBack {
	app: string;
	from: ReleasedImage;
	to: ReleasedImage;
}

/** Neither an app nor every app was asked for. */
export class RollbackNeedsApp extends GkmError {
	constructor(
		readonly stage: string,
		/** The apps that have a release to go back to. */
		readonly apps: readonly string[],
	) {
		super(
			`Say what to roll back: --app <name> for one app (${apps.join(', ') || 'none has an earlier release'}), ` +
				`or --atomic for every app of "${stage}" together.`,
		);
		this.name = 'RollbackNeedsApp';
	}
}

/** An app has no release before the one it runs. */
export class NothingToRollBack extends GkmError {
	constructor(
		readonly stage: string,
		readonly app: string,
	) {
		super(
			`"${app}" has no earlier release on "${stage}" to roll back to: it has been released once, ` +
				'or every earlier release was itself rolled back. Deploy the version you want instead.',
		);
		this.name = 'NothingToRollBack';
	}
}

/** The stage was never deployed through Dokploy from this state. */
export class StageNeverDeployed extends GkmError {
	constructor(readonly stage: string) {
		super(
			`"${stage}" has no deploy state, so there is nothing to roll back. ` +
				'Check the stage name, and that `state` in gkm.config.ts points at the store the deploys write to.',
		);
		this.name = 'StageNeverDeployed';
	}
}

/**
 * Roll a stage's app — or, `atomic`, all of them — back to its previous
 * release, holding the stage's lock as a deploy does.
 */
export async function rollbackStage(
	input: RollbackInput,
): Promise<RolledBack[]> {
	const signal = input.signal ?? new AbortController().signal;
	const log = input.log ?? (() => {});
	const credentials = input.credentials ?? storedCredentials();
	const sandbox =
		input.sandbox ??
		new LocalSandbox({ root: findWorkspaceRoot(resolve(input.cwd)) });

	return withSandbox(sandbox, async () => {
		const { workspace } = await loadWorkspaceConfig(resolve(input.cwd), {
			sandbox,
		});
		assertDeployedStage(workspace.stages, input.stage);
		assertStateOutlivesRun(workspace, input.stage, 'deploy:rollback');

		const store = await createStateStore({
			config: workspace.state,
			workspaceRoot: workspace.root,
			workspaceName: workspace.name,
			namespace: workspace.deploy?.namespace,
		});
		if (!(await store.read(input.stage))) {
			throw new StageNeverDeployed(input.stage);
		}

		const lock = await store.lock(input.stage, { operation: 'rollback' });
		try {
			const journal = await DeployJournal.open(
				store,
				input.stage,
				() => createEmptyState(input.stage, '', ''),
				asDokployState,
			);
			const { state } = journal;
			const releases = state.releases ?? {};
			const restorable = Object.keys(releases).filter(
				(app) => releases[app]!.previous,
			);

			let apps: string[];
			if (input.atomic) {
				apps = restorable;
				if (apps.length === 0) {
					throw new RollbackNeedsApp(input.stage, restorable);
				}
			} else if (input.app) {
				if (!releases[input.app]?.previous) {
					throw new NothingToRollBack(input.stage, input.app);
				}
				apps = [input.app];
			} else {
				throw new RollbackNeedsApp(input.stage, restorable);
			}

			const { api } = await dokployApi(workspace, { credentials, signal });
			const verify = verifySettings(workspace.deploy.dokploy?.verify);
			const rolled: RolledBack[] = [];

			for (const app of apps) {
				signal.throwIfAborted();
				const { current, previous } = releases[app]!;
				const applicationId = state.applications[app];
				if (!previous || !applicationId) {
					throw new NothingToRollBack(input.stage, app);
				}

				log(`⏪ ${app}: ${current.ref} → ${previous.ref}`);
				await restoreImage(api, {
					applicationId,
					image: previous,
					registryId: state.registryId,
					verify,
					signal,
				});
				recordRollback(state, app, previous);
				await journal.save();
				log(`   ✓ ${app} is running ${previous.ref}`);
				rolled.push({ app, from: current, to: previous });
			}

			return rolled;
		} finally {
			await lock.release();
		}
	});
}
