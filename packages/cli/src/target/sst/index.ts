/**
 * The built-in `sst` target: `gkm build` writes the manifest, `sst deploy`
 * provisions it, and the surfaces SST reports are health-checked.
 *
 * `@geekmidas/cloud` is unchanged by it: `sst.config.ts` still reads
 * `.gkm/manifest/aws.ts` and `fromManifest` still makes every resource. What
 * the target adds is the run around the two commands — the lock, the events,
 * verification, and credentials kept where they belong.
 *
 * Both commands run in the sandbox: the build executes the project's code,
 * and so does `sst deploy`, which evaluates `sst.config.ts`. Only the second
 * needs AWS, so the AWS credential goes into that one command's environment
 * and nowhere else — not the build's, not the process the deploy runs in.
 * What `sst deploy` needs beyond them, the sandbox already passes: `PATH`
 * for node and the package manager, and `HOME`, under which SST keeps its
 * toolchain (`~/.config/sst`: bun, pulumi and its plugins) and the AWS SDK
 * finds `~/.aws` for a profile. Its state — the Pulumi backend and the
 * passphrase — is in the stage's own account, reached with that credential.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import {
	type AwsCredential,
	MissingCredential,
} from '../../deploy/credentials';
import type { DeployResult } from '../../deploy/types';
import { detectPackageManager, type PackageManager } from '../../init/utils';
import { CommandFailed } from '../../run';
import { LocalSandbox } from '../../sandbox/local';
import { activeSandbox, type Sandbox } from '../../sandbox/sandbox';
import { appKey } from '../../workspace/derive';
import { defineTarget } from '../define';
import type { DeployPhaseContext, DeployTarget } from '../types';
import { checkHealth, healthUrl, SurfacesUnhealthy } from './health';
import { clearOutputs, readOutputs, surfaceUrls } from './outputs';

export { SurfacesUnhealthy } from './health';
export { SST_OUTPUTS_FILE, SstOutputsUnreadable } from './outputs';

/** A cold build of every handler and site. */
const BUILD_TIMEOUT_MS = 30 * 60_000;
/**
 * A first deploy creates CloudFront distributions and, with a database, a
 * VPC and an RDS instance — each of which alone can take a quarter of an hour.
 */
const DEPLOY_TIMEOUT_MS = 90 * 60_000;

/** The workspace has no `sst.config.ts` for `sst deploy` to run. */
export class SstConfigNotFound extends Error {
	constructor(readonly cwd: string) {
		super(
			`No sst.config.ts in ${cwd}. The sst target runs \`sst deploy\` at the workspace root: scaffold one with \`gkm init --deploy sst\` and copy its sst.config.ts, or deploy through another target with --target.`,
		);
		this.name = 'SstConfigNotFound';
	}
}

/** What the phases hand on. */
export interface SstRun {
	sandbox: Sandbox;
	pm: PackageManager;
	aws: AwsCredential;
	/** The apps SST deploys this run: `ctx.apps` without the skipped. */
	apps: string[];
	/** Each app's URL, from the deploy's outputs. */
	urls: Record<string, string>;
}

export interface SstTargetOptions {
	/** How often, and how patiently, `verify` asks each surface. */
	health?: { attempts?: number; delayMs?: number; timeoutMs?: number };
}

/**
 * The project's own copy of `bin`, through its package manager — never one
 * `npx` would download, which would be code nobody installed.
 */
export function projectCommand(
	pm: PackageManager,
	bin: string,
	args: readonly string[],
): [command: string, args: string[]] {
	switch (pm) {
		case 'pnpm':
			return ['pnpm', ['exec', bin, ...args]];
		case 'yarn':
			return ['yarn', [bin, ...args]];
		case 'bun':
			return ['bunx', [bin, ...args]];
		case 'npm':
			return ['npx', ['--no-install', bin, ...args]];
	}
}

/**
 * The variables `credential` is to the AWS SDK and to SST.
 *
 * A profile is passed alone: given keys too, every SDK would take the keys.
 */
export function awsEnv(credential: AwsCredential): Record<string, string> {
	const region: Record<string, string> = credential.region
		? { AWS_REGION: credential.region, AWS_DEFAULT_REGION: credential.region }
		: {};
	if ('profile' in credential) {
		return { AWS_PROFILE: credential.profile, ...region };
	}
	return {
		AWS_ACCESS_KEY_ID: credential.accessKeyId,
		AWS_SECRET_ACCESS_KEY: credential.secretAccessKey,
		...(credential.sessionToken
			? { AWS_SESSION_TOKEN: credential.sessionToken }
			: {}),
		...region,
	};
}

/**
 * `env` without any `AWS_*`, so a host sandbox that passes some cannot put
 * a second account beside the one the credential names.
 */
function withoutAws(
	env: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).filter(([name]) => !name.startsWith('AWS_')),
	);
}

/** Each app's kind in the manifest, by app key: `rest-api` or `site`. */
function kindsOf(manifest: ConstructManifest): Map<string, string> {
	return new Map(
		Object.entries(manifest).map(([id, declaration]) => [
			appKey(id),
			declaration.kind,
		]),
	);
}

async function exec(
	ctx: DeployPhaseContext<unknown>,
	run: SstRun,
	[command, args]: [string, string[]],
	options: { env: Record<string, string>; timeoutMs: number },
): Promise<void> {
	const result = await run.sandbox.exec(command, args, {
		cwd: ctx.cwd,
		env: options.env,
		timeoutMs: options.timeoutMs,
		output: ctx.childOutput,
		signal: ctx.signal,
	});
	if (result.exitCode !== 0) {
		throw new CommandFailed(
			command,
			args,
			result.exitCode,
			result.signal as NodeJS.Signals | null,
		);
	}
}

/** The `sst` target, with its health checks tuned — for tests and hosts. */
export function createSstTarget(
	options: SstTargetOptions = {},
): DeployTarget<undefined, SstRun> {
	const health = {
		attempts: options.health?.attempts ?? 6,
		delayMs: options.health?.delayMs ?? 5_000,
		timeoutMs: options.health?.timeoutMs ?? 10_000,
	};

	return defineTarget<undefined, SstRun>({
		name: 'sst',
		runtime: 'aws',
		// SST keeps no previous release to return to; migrations run in the
		// stack, as `fromManifest` provisions the database; and nothing here
		// builds an image.
		capabilities: { rollback: false, migrations: 'target', images: false },
		credentials: ['aws'],

		async validate(ctx) {
			if (!existsSync(join(ctx.cwd, 'sst.config.ts'))) {
				throw new SstConfigNotFound(ctx.cwd);
			}

			const aws = await ctx.credentials.get(
				{ kind: 'aws', stage: ctx.stage },
				{ signal: ctx.signal },
			);
			if (!aws) throw new MissingCredential('aws', ctx.stage);
			if (!('profile' in aws)) {
				ctx.secrets.mask(aws.secretAccessKey);
				if (aws.sessionToken) ctx.secrets.mask(aws.sessionToken);
			}

			// A mobile app ships through its own store's toolchain.
			for (const app of ctx.apps) {
				if (ctx.workspace.apps[app]?.type === 'mobile') {
					ctx.skip(app, 'mobile apps deploy through their own toolchain');
				}
			}
			const skipped = new Set(ctx.skipped.map(({ app }) => app));
			const apps = ctx.apps.filter((app) => !skipped.has(app));

			ctx.logger.info(
				`\n🚀 Deploying "${ctx.workspace.name}" to the "${ctx.stage}" stage with SST`,
			);
			ctx.logger.info(
				`   AWS: ${'profile' in aws ? `profile "${aws.profile}"` : 'access keys'}`,
			);
			// `sst deploy` takes the whole stack: there is no deploying one app.
			const deployable = Object.values(ctx.workspace.apps).filter(
				(app) => app.type !== 'mobile',
			).length;
			if (apps.length < deployable) {
				ctx.logger.warn(
					`   sst deploy deploys every construct of the stage, not only ${apps.join(', ')}.`,
				);
			}

			return {
				sandbox: activeSandbox() ?? new LocalSandbox({ root: ctx.cwd }),
				pm: detectPackageManager(ctx.cwd),
				aws,
				apps,
				urls: {},
			};
		},

		async plan(ctx, run) {
			const kinds = kindsOf(ctx.manifest);
			for (const app of run.apps) {
				ctx.emit({
					type: 'resource.planned',
					key: `application:${app}`,
					resourceType: kinds.get(app) ?? 'application',
					action: 'ensure',
				});
			}
			const [build, buildArgs] = buildCommand(ctx, run);
			const [deploy, deployArgs] = deployCommand(ctx, run);
			ctx.logger.info(`   Would run: ${[build, ...buildArgs].join(' ')}`);
			ctx.logger.info(`   Would run: ${[deploy, ...deployArgs].join(' ')}`);
		},

		async build(ctx, run) {
			ctx.logger.info('\n📦 Building the manifest SST deploys');
			// No credential: the build runs the project's code and needs none.
			await exec(ctx, run, buildCommand(ctx, run), {
				env: { ...run.sandbox.env },
				timeoutMs: BUILD_TIMEOUT_MS,
			});
		},

		async release(ctx, run) {
			ctx.logger.info(`\n☁️  sst deploy --stage ${ctx.stage}`);
			await clearOutputs(ctx.cwd);
			await exec(ctx, run, deployCommand(ctx, run), {
				env: { ...withoutAws(run.sandbox.env), ...awsEnv(run.aws) },
				timeoutMs: DEPLOY_TIMEOUT_MS,
			});

			run.urls = surfaceUrls(await readOutputs(ctx.cwd), run.apps);
			for (const app of run.apps) {
				ctx.emit({
					type: 'app.deployed',
					app,
					applicationId: ctx.name(app),
					// SST builds no image a registry holds.
					imageRef: '',
					url: run.urls[app] ?? '',
				});
			}
		},

		async verify(ctx, run) {
			const unhealthy: SurfacesUnhealthy['surfaces'][number][] = [];

			for (const app of run.apps) {
				const base = run.urls[app];
				if (!base) {
					ctx.logger.warn(
						`   ⚠ No URL for ${app} in SST's outputs, so it was not checked. Return it from run() in sst.config.ts — { ${app}: <its url> } — to have it checked.`,
					);
					continue;
				}
				// A surface — a `rest-api` — is the backend app it derives.
				const backend = ctx.workspace.apps[app]?.type === 'backend';
				const url = healthUrl(base, backend ? '/health' : '/');
				const answer = await checkHealth(app, url, {
					...health,
					signal: ctx.signal,
					emit: ctx.emit,
				});
				if (answer.healthy) {
					ctx.logger.info(`   ✓ ${app}: ${url}`);
				} else {
					unhealthy.push({
						app,
						url,
						...(answer.status !== undefined ? { status: answer.status } : {}),
						...(answer.error ? { error: answer.error } : {}),
					});
				}
			}

			if (unhealthy.length > 0) {
				throw new SurfacesUnhealthy(ctx.stage, unhealthy);
			}
		},

		result(ctx, run): DeployResult {
			return {
				apps: run.apps.map((appName) => ({
					appName,
					type: ctx.workspace.apps[appName]?.type ?? 'backend',
					success: true,
					...(run.urls[appName] ? { url: run.urls[appName] } : {}),
				})),
				projectId: '',
				environmentId: '',
				successCount: ctx.dryRun ? 0 : run.apps.length,
				failedCount: 0,
				stage: ctx.stage,
				identity: ctx.identity.key,
				tag: ctx.tag,
				dryRun: ctx.dryRun,
				skipped: [...ctx.skipped],
				urls: { ...run.urls },
				changes: [],
			};
		},
	});
}

function buildCommand(
	ctx: DeployPhaseContext<unknown>,
	run: SstRun,
): [string, string[]] {
	return projectCommand(run.pm, 'gkm', [
		'build',
		'--provider',
		'aws',
		'--stage',
		ctx.stage,
	]);
}

function deployCommand(
	ctx: DeployPhaseContext<unknown>,
	run: SstRun,
): [string, string[]] {
	return projectCommand(run.pm, 'sst', ['deploy', '--stage', ctx.stage]);
}

export const sstTarget = createSstTarget();
