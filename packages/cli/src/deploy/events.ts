/**
 * What a deploy reports while it runs.
 *
 * Plain JSON objects, discriminated by `type`: `gkm deploy --json` writes them
 * one per line, and a host can forward them to a UI or a log pipeline without
 * a serialiser of its own. Nothing in an event is a class instance, a function
 * or a secret — an error travels as its name and message, a credential never
 * travels at all.
 *
 * This is the union a `DeployTarget` will report through (#150), which is why
 * the phases are named for the target lifecycle even though today's one target
 * builds and releases each app in turn inside `release`.
 */

import type { DeployResult } from './types';

/**
 * The stretch of a deploy an event belongs to.
 *
 * - `validate`: the config, the stage, the apps, the lock, the stage's secrets
 *   and what each app reads from its environment
 * - `plan`: a dry run's lookups — what would be created and what reused
 * - `provision`: the Dokploy project, environment and registry, and the
 *   declared constructs
 * - `release`: each app's image built, pushed and deployed
 * - `verify`: DNS records and Dokploy's domain validation
 */
export type DeployPhase =
	| 'validate'
	| 'plan'
	| 'provision'
	| 'release'
	| 'verify';

/** An error, as an event carries it. */
export interface DeployEventError {
	/** The error's class name — `MissingCredential`, `StateLocked`. */
	name: string;
	message: string;
}

/**
 * How a resource came to be used:
 * - `recorded`: the id the stage's state holds still resolves
 * - `resumed`: a run that died after creating it is picked up
 * - `found`: it existed and was looked up
 * - `created`: this run created it
 */
export type ResourceVia = 'recorded' | 'resumed' | 'found' | 'created';

/** One resource a deploy touches, planned or applied. */
export interface ResourceChange {
	/** `<type>:<name>`, unique within the stage — `application:api`. */
	key: string;
	/** `project`, `environment`, `registry`, `application`, `domain`, `image`, or a construct's kind. */
	resourceType: string;
	/**
	 * For a plan: whether the run would create it, reuse what exists, or
	 * ensure it (look it up, and create it if missing). For an applied change:
	 * what was done.
	 */
	action: 'create' | 'reuse' | 'ensure' | 'build';
	/** The target's id, once there is one. */
	id?: string;
}

export type DeployEvent =
	| {
			type: 'deploy.started';
			stage: string;
			/** `<namespace>/<project>`. */
			identity: string;
			tag: string;
			/** The apps this run deploys, in order. */
			apps: string[];
			dryRun: boolean;
	  }
	| { type: 'phase.started'; phase: DeployPhase }
	| { type: 'phase.finished'; phase: DeployPhase }
	/**
	 * A progress line, exactly as `gkm deploy` prints it — leading newline and
	 * indentation included, so a terminal renderer prints `message` as is.
	 */
	| { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
	| { type: 'app.skipped'; app: string; reason: string }
	| ({ type: 'resource.planned' } & ResourceChange)
	| ({ type: 'resource.applied'; via: ResourceVia } & ResourceChange & {
				id: string;
			})
	| {
			type: 'artifact.built';
			app: string;
			imageRef: string;
			/** The registry's digest, `sha256:…`, once pushed. */
			digest?: string;
	  }
	| {
			type: 'app.deployed';
			app: string;
			applicationId: string;
			imageRef: string;
			url: string;
	  }
	| { type: 'app.failed'; app: string; error: DeployEventError }
	| { type: 'deploy.finished'; result: DeployResult }
	| { type: 'deploy.failed'; error: DeployEventError };

/** Every `type` a deploy event can have. */
export type DeployEventType = DeployEvent['type'];

/** An error as an event carries it: its name and message, nothing else. */
export function eventError(error: unknown): DeployEventError {
	if (error instanceof Error) {
		return { name: error.name, message: error.message };
	}
	return { name: 'Error', message: String(error) };
}
