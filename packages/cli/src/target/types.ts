/**
 * What a deploy target is: the contract `gkm deploy` runs a stage through,
 * whether the target ships with the CLI (`dokploy`) or comes from a package
 * the project names in `deploy.targets`.
 *
 * Types only. Everything here describes values the CLI hands a target or the
 * target hands back; nothing in this file runs, so a plugin that imports it
 * loads nothing of the CLI.
 */

import type { ConstructManifest } from '@geekmidas/manifest';
import type { CredentialKind, CredentialProvider } from '../deploy/credentials';
import type { DeployEvent } from '../deploy/events';
import type { DeployIdentity } from '../deploy/identity';
import type { StateStore } from '../deploy/StateStore';
import type { DeployResult } from '../deploy/types';
import type { StageSecrets } from '../secrets/types';
import type { NormalizedWorkspace } from '../workspace/types';

/**
 * Which family of defaults a target's deploys belong to.
 *
 * - `server`: the target runs containers the project controls, so a cache can
 *   live in the database and events go through pg-boss.
 * - `aws`: the target runs on managed AWS services, so the defaults are
 *   Upstash, S3 and SNS/SQS.
 *
 * `gkm dev` and `gkm build` choose backends by it, which is why a target from
 * a package declares it in its `package.json` too: they read it without
 * importing the target.
 */
export type DeployRuntime = 'server' | 'aws';

/** What a target can do, beyond the phases every target has. */
export interface DeployTargetCapabilities {
	/**
	 * Whether `rollback` restores the previous release. When it does, a failed
	 * `release` or `verify` is rolled back before the deploy reports failure.
	 */
	rollback: boolean;
	/**
	 * Who applies database migrations: the target, as part of `release`, or
	 * the app itself when it starts.
	 */
	migrations: 'target' | 'app';
	/**
	 * Whether the target builds container images — and so needs Docker where
	 * the deploy runs, and a registry to push to.
	 */
	images: boolean;
	/**
	 * Whether it can also run the project's local stage — `gkm deploy --stage
	 * <local>`. Only a target that runs on this machine can: a stack started
	 * here is the local stage's, while one on a server is shared, and the local
	 * stage's secrets are a developer's. Absent, a deploy refuses the local
	 * stage with `UndeclaredStage`.
	 */
	localStage?: boolean;
	/**
	 * Whether it runs telemetry's self-hosted provider — OpenObserve beside
	 * the apps — for a stage whose `deploy.telemetry` asks for it, or names
	 * nothing. Absent, a stage that uses a `Telemetry` construct names a
	 * provider of its own (`otlp`) or opts out with `false`.
	 */
	selfHostedTelemetry?: boolean;
}

/** A failed validation of a target's options, issue by issue. */
export interface TargetOptionsIssue {
	readonly message: string;
	readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

type TargetOptionsResult<Output> =
	| { readonly value: Output; readonly issues?: undefined }
	| { readonly issues: ReadonlyArray<TargetOptionsIssue> };

/**
 * The schema a target's options are validated with: any Standard Schema —
 * a Zod, Valibot or ArkType schema is one.
 *
 * The interface is the Standard Schema spec's own, copied as the spec asks,
 * so a target's types do not depend on a package the CLI does not ship.
 */
export interface TargetOptionsSchema<Output = unknown> {
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
		) => TargetOptionsResult<Output> | Promise<TargetOptionsResult<Output>>;
		readonly types?:
			| { readonly input: unknown; readonly output: Output }
			| undefined;
	};
}

/**
 * The stage's secrets, as a target reads and writes them.
 *
 * Every secret value read through here is masked: a progress line that
 * would print one prints `***` instead, in the terminal and in the events.
 */
export interface DeploySecrets {
	/** Which kind of store holds them — `'file'`, `'s3'`, `'ssm'`, `'secrets-manager'`, or
	 * a custom one's. */
	readonly store: string;
	/** The stage's secrets, or null when it has none yet. */
	read(): Promise<StageSecrets | null>;
	/** Replace the stage's secrets. */
	write(secrets: StageSecrets): Promise<void>;
	/** Mask `value` in everything this run prints or emits from now on. */
	mask(value: string): void;
}

/** Where a target's progress lines go: `log` events of the run. */
export interface DeployTargetLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

/**
 * The events a target reports. The run's own — `deploy.*` and `phase.*` —
 * are the CLI's, which emits them around each phase it calls.
 */
export type TargetEvent = Exclude<
	DeployEvent,
	{
		type:
			| 'deploy.started'
			| 'deploy.finished'
			| 'deploy.failed'
			| 'phase.started'
			| 'phase.finished'
			| 'phase.failed';
	}
>;

/** Everything a phase is handed. The same object for every phase of a run. */
export interface DeployPhaseContext<Options = undefined> {
	/** The name the target was resolved by — `deploy.default`, `--target`. */
	readonly target: string;
	/**
	 * The workspace root. Never `process.cwd()`: a host deploys projects
	 * that are not where it runs.
	 */
	readonly cwd: string;
	readonly stage: string;
	/** The image tag, or whatever version label the target releases under. */
	readonly tag: string;
	/**
	 * Whether `tag` was asked for (`--tag`) rather than made up for this run
	 * — by the target's own `tag()`, else `<stage>-<timestamp>`. A target that
	 * releases what CI already pushed when given one tells the two apart here.
	 */
	readonly tagGiven: boolean;
	/**
	 * The apps this target deploys, in dependency order: those asked for that
	 * deploy here. Apps that deploy elsewhere are already in `skipped`.
	 */
	readonly apps: readonly string[];
	/** The apps the run leaves out, and why. */
	readonly skipped: readonly { app: string; reason: string }[];
	/** Who the deploy is, for naming and claiming what it creates. */
	readonly identity: DeployIdentity;
	/** The workspace, with its apps derived from the manifest. */
	readonly workspace: NormalizedWorkspace;
	/** What the workspace declares. */
	readonly manifest: ConstructManifest;
	/**
	 * Each owner's runnables' edges, from the same discovery — what a process
	 * that runs them reads, beyond what its own declaration lists.
	 */
	readonly runnables?: Readonly<Record<string, readonly string[]>>;
	/**
	 * Where each Worker's crons, queues and subscribers are declared, from the
	 * same discovery: which workers have work to run, and which app each is
	 * built from (`workerUnits`).
	 */
	readonly background?: Readonly<Record<string, readonly string[]>>;
	/** The target's options, as its `options` schema parsed them. */
	readonly options: Options;
	/**
	 * Look everything up and report what would happen — as `resource.planned`
	 * events — without changing anything. Only `validate` and `plan` run.
	 */
	readonly dryRun: boolean;
	/**
	 * When `release` or `verify` fails, roll back every app the run released
	 * rather than only those that failed — for apps that must move together,
	 * an API and the site built against it. Only a target that can roll back
	 * reads it.
	 */
	readonly atomic: boolean;
	/**
	 * `--allow-dev-services`: a deployed stage runs the dev service for every
	 * bucket and mail it does not account for — no key in its secrets, no
	 * provider backing the kind. Off by default: a deployed stage's mail and
	 * buckets come from its secrets or its providers, and a server target
	 * refuses one that lacks them. The local stage ignores it — it always
	 * runs both.
	 */
	readonly allowDevServices: boolean;
	/**
	 * `--skip-dns`: a server target neither writes its public hosts' DNS
	 * records nor checks that they point at the stage's server — for a CDN or
	 * proxy in front of it, or records written by another step.
	 */
	readonly skipDns?: boolean;
	/** Where every credential comes from. Nothing prompts. */
	readonly credentials: CredentialProvider;
	/**
	 * The stage's deploy state. A real run holds the stage's lock for every
	 * phase; a dry run holds none and must write nothing.
	 */
	readonly state: StateStore;
	readonly secrets: DeploySecrets;
	readonly logger: DeployTargetLogger;
	/** Fires when the run is stopped; every phase stops what it is doing. */
	readonly signal: AbortSignal;
	/**
	 * Where the output of what a phase spawns goes: the host's terminal, its
	 * stderr (so stdout carries only events), or nowhere.
	 */
	readonly childOutput: 'inherit' | 'stderr' | 'ignore';
	/** Report progress. */
	emit(event: TargetEvent): void;
	/** Leave an app out of this run, with the reason a person will read. */
	skip(app: string, reason: string): void;
	/**
	 * What a resource is called on the target: scoped by the stage and the
	 * identity exactly as the constructs are — `name('api')` is
	 * `production-shop-api`. Two workspaces, or two stages, never share one.
	 */
	name(resource: string): string;
}

/** Why `rollback` was called: the phase that failed, and its error. */
export interface DeployFailure {
	readonly phase: 'release' | 'verify';
	readonly error: unknown;
}

/**
 * A deploy target.
 *
 * The CLI calls the phases in order — `validate`, then `plan` for a dry run,
 * or `provision → build → release → verify` for a real one — emitting
 * `phase.started`/`phase.finished` around each. Every phase must be safe to
 * run again: a deploy stopped part way is finished by deploying again, so a
 * phase finds what an earlier run made (through `state`) before making it.
 *
 * `Run` is whatever the target carries from one phase to the next within a
 * run — `validate` makes it, every later phase is handed it.
 *
 * ```ts
 * import { defineTarget } from '@geekmidas/cli/target';
 * import { z } from 'zod';
 *
 * export default defineTarget({
 *   name: 'fly',
 *   runtime: 'server',
 *   capabilities: { rollback: true, migrations: 'target', images: true },
 *   options: z.object({ org: z.string(), region: z.string().default('ams') }),
 *   async validate(ctx) {
 *     return { org: ctx.options.org, region: ctx.options.region };
 *   },
 *   async plan(ctx, run) { … },
 *   async release(ctx, run) { … },
 *   async rollback(ctx, run, failure) { … },
 *   result(ctx, run) { … },
 * });
 * ```
 */
export interface DeployTarget<Options = undefined, Run = unknown> {
	/** The target's own name, for messages. Config refers to it by its key. */
	readonly name: string;
	readonly runtime: DeployRuntime;
	readonly capabilities: DeployTargetCapabilities;
	/**
	 * What `deploy.targets` may pass it — `[package, options]` — validated
	 * before any phase runs. Without one, the target takes no options.
	 */
	readonly options?: TargetOptionsSchema<Options>;
	/**
	 * The kinds of credential it asks the run's `CredentialProvider` for, so a
	 * host or `gkm login` can collect them up front.
	 */
	readonly credentials?: readonly CredentialKind[];

	/**
	 * The tag a run releases under when none is asked for. Without one it is
	 * `<stage>-<timestamp>`; a target that builds from the checkout can name
	 * its images after the commit instead.
	 */
	tag?(where: {
		readonly cwd: string;
		readonly stage: string;
	}): Promise<string>;

	/**
	 * What the run is — the apps, the images, what each runs with — checked
	 * before anything changes. A build-only run calls it too, so it checks
	 * what building needs; what only a deploy needs is `ready`'s.
	 */
	validate(ctx: DeployPhaseContext<Options>): Promise<Run>;
	/**
	 * What only this target checks before a deploy changes anything — compose's
	 * server address and its hosts' DNS. Run after `validate` and the stage's
	 * own readiness check (every key it needs, after its providers wrote
	 * theirs), on a deploy and its dry run. A build-only run never calls it:
	 * an image needs none of it.
	 */
	ready?(ctx: DeployPhaseContext<Options>, run: Run): Promise<void>;
	/** A dry run: emit `resource.planned` for what a real run would do. */
	plan(ctx: DeployPhaseContext<Options>, run: Run): Promise<void>;
	/** Create or find what the apps run on, and what they declare. */
	provision?(ctx: DeployPhaseContext<Options>, run: Run): Promise<void>;
	/** Build each app's artifact (`artifact.built`), changing nothing live. */
	build?(ctx: DeployPhaseContext<Options>, run: Run): Promise<void>;
	/** Put the built artifacts live (`app.deployed`). */
	release(ctx: DeployPhaseContext<Options>, run: Run): Promise<void>;
	/** Check what was released answers (`health.checked`). */
	verify?(ctx: DeployPhaseContext<Options>, run: Run): Promise<void>;
	/**
	 * Restore the previous release, after `release` or `verify` failed. Called
	 * only when `capabilities.rollback` is true.
	 */
	rollback?(
		ctx: DeployPhaseContext<Options>,
		run: Run,
		failure: DeployFailure,
	): Promise<void>;
	/** What the run did, once its last phase has finished. */
	result(
		ctx: DeployPhaseContext<Options>,
		run: Run,
	): DeployResult | Promise<DeployResult>;
}

/**
 * A target of any options and run state — what the CLI holds once a target
 * is resolved, its types left behind in the config that named it. The phases
 * are methods, so their parameters are compared bivariantly and every
 * `DeployTarget<O, R>` is one.
 */
export type AnyDeployTarget = DeployTarget<unknown, unknown>;

/** A target's options type, from the target. */
export type TargetOptions<T> =
	T extends DeployTarget<infer O, infer _Run> ? O : never;

/**
 * One `deploy.targets` entry:
 *
 * - `'@acme/gkm-target'` — a package, its default export the target
 * - a target object, from `defineTarget` or a package's factory
 * - `['@acme/gkm-target', { region: 'ams' }]` — either, with options
 */
export type DeployTargetEntry =
	| string
	| AnyDeployTarget
	| readonly [string | AnyDeployTarget, unknown];
