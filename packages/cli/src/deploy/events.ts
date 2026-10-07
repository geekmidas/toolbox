/**
 * What a deploy reports while it runs.
 *
 * Plain JSON objects, discriminated by `type`: `gkm deploy --json` writes them
 * one per line, and a host can forward them to a UI or a log pipeline without
 * a serialiser of its own. Nothing in an event is a class instance, a function
 * or a secret — an error travels as its name and message, a credential never
 * travels at all.
 *
 * Every target reports through this one union, so a UI renders a Dokploy
 * deploy and a plugin's the same way.
 *
 * The union only grows: a new event is a new `type`, a new field is optional,
 * and nothing that exists changes meaning. A consumer ignores types it does
 * not know. That is why the events carry no version number — the CLI that
 * writes a stream and the program that reads it agree by that rule rather
 * than by negotiating one.
 */

import type { DeployResult } from './types';

/**
 * The stretch of a deploy an event belongs to.
 *
 * - `validate`: the config, the target, the stage, the apps, the lock, the
 *   stage's secrets and what each app reads from its environment
 * - `plan`: a dry run's lookups — what would be created and what reused
 * - `provision`: what the apps run on — for Dokploy the project, environment
 *   and registry — and the declared constructs
 * - `build`: each app's artifact, built without changing anything live
 * - `release`: the artifacts put live. Dokploy applies the stage's
 *   migrations, then builds and pushes each image here, beside its
 *   application, because a site's build args are resolved per app — and
 *   checks each backend before any site is released
 * - `verify`: what was released answers — for Dokploy, each site's DNS
 *   records and health
 * - `rollback`: the previous release restored, after `release` or `verify`
 *   failed, on a target that can
 */
export type DeployPhase =
	| 'validate'
	| 'plan'
	| 'provision'
	| 'build'
	| 'release'
	| 'verify'
	| 'rollback';

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
			/** The target the run deploys through, by the name it was given. */
			target: string;
			/** `<namespace>/<project>`. */
			identity: string;
			tag: string;
			/** The apps this run deploys, in order. */
			apps: string[];
			dryRun: boolean;
	  }
	| { type: 'phase.started'; phase: DeployPhase }
	| { type: 'phase.finished'; phase: DeployPhase }
	/** A phase threw; `deploy.failed` follows (after a rollback, if any). */
	| { type: 'phase.failed'; phase: DeployPhase; error: DeployEventError }
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
	/** One check of whether a released app answers. */
	| {
			type: 'health.checked';
			app: string;
			/** What was asked: a URL, or the target's own status check. */
			url: string;
			healthy: boolean;
			/** The HTTP status, when the check was a request. */
			status?: number;
			/** 1 for the first check of the app in this run. */
			attempt: number;
	  }
	/**
	 * A deployed stage runs a dev service — `--allow-dev-services` — in place
	 * of real mail or object storage: Mailpit delivers no mail, MinIO keeps
	 * every object on one container's disk. A warning, every run.
	 */
	| {
			type: 'dev-service.used';
			service: 'minio' | 'mailpit';
			stage: string;
			/** The constructs it stands in for. */
			constructs: string[];
	  }
	/**
	 * The stack's log UI (`deploy.compose.logs`) is up and answering: where
	 * it is and how it is reached — through an SSH tunnel to a loopback
	 * port, or publicly on a host that allows only some addresses.
	 */
	| {
			type: 'logs.ready';
			service: 'openobserve';
			access: 'tunnel' | 'public';
			/** Where a browser opens it: the tunnel's end, or its public host. */
			url: string;
			/** The loopback port it is published on, for a tunnel. */
			port?: number;
			/** The addresses a public host answers. */
			allow?: string[];
			email: string;
	  }
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
