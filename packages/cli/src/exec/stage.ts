/**
 * `gkm exec --stage <stage> -- <command>`: a command run on this machine as
 * a deployed compose stage's app — a data import, a backfill, a report.
 *
 * The app's environment is the one its container runs with, derived the way
 * the deploy derives it (`composeStack`) from the stage's secrets, read from
 * the stage's store the way the deploy reads them. Only what the container
 * reaches on the stack's network is moved: each service it names that the
 * server publishes on its loopback — Postgres, MinIO — is reached through an
 * SSH tunnel on the deploy's own login (`ServerAccess.tunnel`), and each
 * sibling app through its public address.
 *
 * Nothing is written to disk. The values exist only in the command's
 * environment, and its Credentials are filled from there by a preload that
 * is a `data:` URL naming the keys — never their values.
 */

import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import type { ConstructManifest } from '@geekmidas/manifest';
import { type ComposeDocker, dockerCompose } from '../compose/docker.js';
import { deployedStackSecrets } from '../compose/secrets.js';
import {
	type ComposeServer,
	composeServer,
	dockerHost,
	type ServerAccess,
	sshAccess,
	type Tunnel,
} from '../compose/server.js';
import { type ComposeStack, composeStack } from '../compose/stack.js';
import { edgeAlias } from '../compose/traefik.js';
import {
	loadWorkspaceAppInfo,
	loadWorkspaceConfig,
	NotInAnApp,
} from '../config.js';
import { deployIdentity } from '../deploy/identity.js';
import { GkmError } from '../errors';
import { prompt } from '../prompt.js';
import { deploysWithCompose } from '../providers/dns.js';
import { discover } from '../reconcile/discover.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { secretsStoreFor } from '../secrets/store.js';
import type { StageSecrets } from '../secrets/types.js';
import { edgePorts } from '../target/compose/phases.js';
import { assertDeployedStage } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

const logger = console;

/** The stage is not one the compose target deploys. */
export class ExecStageNotComposed extends GkmError {
	constructor(readonly stage: string) {
		super(
			`gkm exec --stage runs a command against a compose stage's server, and ` +
				`'${stage}' is not deployed with compose. Set deploy.default: 'compose' ` +
				'in gkm.config.ts, or run the command where the stage runs.',
		);
		this.name = 'ExecStageNotComposed';
	}
}

/** The stage's secrets lack what its deploy generates: it was never deployed. */
export class ExecStageNotDeployed extends GkmError {
	constructor(
		readonly stage: string,
		readonly missing: readonly string[],
	) {
		super(
			`'${stage}' has no ${missing.join(', ')} in its secrets yet, so what its ` +
				'apps run with is not decided. Deploy it first: ' +
				`gkm deploy --stage ${stage}.`,
		);
		this.name = 'ExecStageNotDeployed';
	}
}

/** The directory is not one of the stack's apps. */
export class ExecAppNotInStack extends GkmError {
	constructor(
		readonly stage: string,
		readonly app: string | undefined,
		readonly apps: readonly string[],
	) {
		super(
			`${app ? `'${app}' is not` : 'This directory is not in'} one of the apps ` +
				`'${stage}' runs (${apps.join(', ')}), so there is no environment to run ` +
				`as. Run from an app's directory: cd apps/${apps[0] ?? '<app>'} && ` +
				`gkm exec --stage ${stage} -- <command>.`,
		);
		this.name = 'ExecAppNotInStack';
	}
}

/** A protected stage, and nobody said yes. */
export class ExecNotConfirmed extends GkmError {
	constructor(readonly stage: string) {
		super(`Nothing was run against '${stage}'.`);
		this.name = 'ExecNotConfirmed';
	}
}

export interface StageExecOptions {
	stage: string;
	/** The AWS profile for the stage's account, where its secrets are kept. */
	profile?: string;
	/**
	 * The SSH login to reach the server as, in place of
	 * `deploy.compose.server.<stage>.user` — a person's own, where the
	 * deploy's key lives only in CI.
	 */
	sshUser?: string;
	/** Run against a protected stage without asking. */
	yes?: boolean;
	cwd?: string;
}

/** What the command needs from outside the process, so tests can stand in. */
export interface StageExecDeps {
	/** The server's Docker, asked which port each service publishes. */
	docker: ComposeDocker;
	/** The tunnels to the server's loopback. */
	server: ServerAccess;
	/** Asked before running against a protected stage. */
	confirm: (question: string) => Promise<boolean>;
	/** Where the edge's ports are read from, as the deploy reads them. */
	env: NodeJS.ProcessEnv;
}

export const defaultStageExecDeps: StageExecDeps = {
	docker: dockerCompose,
	server: sshAccess,
	confirm: async (question) => {
		const answer = await prompt(`${question} [y/N] `, {
			instead: 'Pass --yes to run without asking.',
		});
		return /^y(es)?$/i.test(answer.trim());
	},
	env: process.env,
};

/** A service on the stack's network the app's environment names. */
export interface StackAddress {
	service: string;
	port: number;
}

/**
 * The environment an app runs with on the stage: a backend's container's,
 * over the keys of each worker built from it; a site's or a mobile app's,
 * the public values its build reads.
 *
 * @throws {ExecAppNotInStack}
 */
export function appEnvironment(
	stack: Pick<ComposeStack, 'stage' | 'apps' | 'workers' | 'mobileApps'>,
	appName: string | undefined,
): Record<string, string> {
	const mobile = stack.mobileApps.find(
		(candidate) => candidate.name === appName,
	);
	if (mobile) return { ...mobile.values };
	const app = stack.apps.find((candidate) => candidate.name === appName);
	if (!app) {
		throw new ExecAppNotInStack(stack.stage, appName, [
			...stack.apps.map((candidate) => candidate.name),
			...stack.mobileApps.map((candidate) => candidate.name),
		]);
	}
	if (app.kind === 'site') return { ...app.build?.args };
	const workers = stack.workers.filter((worker) => worker.host === app.name);
	return Object.assign(
		{},
		...workers.map((worker) => worker.env ?? {}),
		app.env ?? {},
	);
}

/** `host:port`, at a URL's authority — after `//` or a login's `@`. */
function authority(host: string, port: number): RegExp {
	return new RegExp(
		`(?<=[/@,])${host.replace(/[.-]/g, '\\$&')}:${port}(?!\\d)`,
		'g',
	);
}

/**
 * Each of the stack's services the environment reaches on the stack's
 * network, once: `postgres:5432`, `minio:9000`.
 */
export function stackAddresses(
	env: Readonly<Record<string, string>>,
	stack: Pick<ComposeStack, 'infra'>,
): StackAddress[] {
	const found = new Map<string, StackAddress>();
	const pattern = /(?<=[/@,])([a-z0-9-]+):(\d+)(?!\d)/g;
	for (const value of Object.values(env)) {
		for (const match of value.matchAll(pattern)) {
			const service = match[1]!;
			if (!stack.infra.includes(service)) continue;
			const port = Number(match[2]);
			found.set(`${service}:${port}`, { service, port });
		}
	}
	return [...found.values()];
}

/**
 * The environment as this machine reaches it: each service at its tunnel's
 * local port, and each sibling app at its public address. What has no
 * tunnel is left as the container has it.
 */
export function throughTunnels(
	env: Readonly<Record<string, string>>,
	stack: Pick<ComposeStack, 'apps' | 'project'>,
	tunnels: ReadonlyMap<string, number>,
): Record<string, string> {
	const rewrites: [RegExp, string][] = [];
	for (const [address, port] of tunnels) {
		const [service, inside] = address.split(':');
		rewrites.push([authority(service!, Number(inside)), `127.0.0.1:${port}`]);
	}
	for (const app of stack.apps) {
		for (const host of [app.name, edgeAlias(stack.project, app.name)]) {
			rewrites.push([
				new RegExp(
					`http://${host.replace(/[.-]/g, '\\$&')}:${app.port}(?!\\d)`,
					'g',
				),
				app.url,
			]);
		}
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		out[key] = rewrites.reduce(
			(current, [pattern, replacement]) =>
				current.replace(pattern, () => replacement),
			value,
		);
	}
	return out;
}

/**
 * The preload that fills Credentials from the command's own environment: a
 * `data:` URL holding the keys, so no file — and no value — is written.
 */
export function credentialsImport(keys: readonly string[]): string {
	const source =
		'globalThis.__gkm_credentials__=Object.fromEntries(' +
		`${JSON.stringify(keys)}.map((k)=>[k,process.env[k]]));`;
	return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

/** A deployed compose stage, as its deploy has it, and the app here. */
export interface LoadedStage {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	stack: ComposeStack;
	/** The stage's secrets, as its deploy reads them. */
	secrets: StageSecrets;
	/** The app this directory is, if it is one. */
	appName: string | undefined;
	protectedStage: boolean;
}

/**
 * The stage's stack, and the app this directory is, as the deploy has them:
 * its secrets read from its store, its values derived as the deploy derives
 * them. Nothing is reached but the store — no server, no SSH.
 *
 * @throws {UndeclaredStage}, {ExecStageNotComposed}, {ExecStageNotDeployed}
 */
export async function loadStage(
	options: Pick<StageExecOptions, 'stage' | 'profile' | 'cwd'>,
	env: NodeJS.ProcessEnv = process.env,
): Promise<LoadedStage> {
	const cwd = options.cwd ?? process.cwd();
	const { stage } = options;
	// Outside an app the workspace is still loaded, so the stage is checked
	// before the directory is refused.
	const info = await loadWorkspaceAppInfo(cwd).catch((error) => {
		if (error instanceof NotInAnApp) return undefined;
		throw error;
	});
	const workspace =
		info?.workspace ?? (await loadWorkspaceConfig(cwd)).workspace;

	assertDeployedStage(workspace.stages, stage);
	if (!deploysWithCompose(workspace)) throw new ExecStageNotComposed(stage);

	const runnables: Record<string, string[]> = {};
	const background: Record<string, string[]> = {};
	const manifest: ConstructManifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
		runnables,
		background,
	});

	const store = await secretsStoreFor(workspace, stage, {
		...(options.profile ? { profile: options.profile } : {}),
	});
	const { secrets, generated } = deployedStackSecrets(
		workspace,
		stage,
		await store.read(stage),
		manifest,
	);
	if (generated.length > 0) throw new ExecStageNotDeployed(stage, generated);

	const stack = composeStack({
		workspace,
		manifest,
		runnables,
		background,
		stage,
		identity: deployIdentity(workspace, stage),
		// Built, so a site's public values are resolved as its build has them.
		images: { mode: 'build', tag: 'exec' },
		secrets,
		ports: edgePorts(env),
	});
	return {
		workspace,
		manifest,
		stack,
		secrets,
		appName: info?.appName,
		protectedStage: workspace.stages.protected?.includes(stage) ?? false,
	};
}

/** The stage's server, as SSH reaches it: `--ssh-user` over the config's. */
function stageServer(
	loaded: LoadedStage,
	options: StageExecOptions,
): ComposeServer {
	const server = composeServer({
		stage: options.stage,
		local: false,
		config: loaded.workspace.deploy?.compose?.server,
		custom: loaded.secrets.custom,
	})!;
	if (options.sshUser) server.user = options.sshUser;
	return server;
}

/**
 * Run `commandArgs` as the app this directory is, on the stage — through a
 * tunnel to each service it reaches — and return its exit code. Every tunnel
 * is closed once it exits, whatever it exits with.
 *
 * @throws {ExecStageNotComposed}, {ExecStageNotDeployed}, {ExecAppNotInStack},
 *   {ExecNotConfirmed}, {ComposeServerUnreachable}
 */
export async function execOnStage(
	commandArgs: readonly [string, ...string[]],
	options: StageExecOptions,
	deps: StageExecDeps = defaultStageExecDeps,
): Promise<number> {
	const { stage } = options;
	const loaded = await loadStage(options, deps.env);
	const { stack, appName, protectedStage } = loaded;
	const env = appEnvironment(stack, appName);

	if (protectedStage && !options.yes) {
		const question = `'${stage}' is a protected stage. Run ${commandArgs.join(' ')} against it?`;
		if (!(await deps.confirm(question))) throw new ExecNotConfirmed(stage);
	}

	// Only what reaches a service on the stack needs the server: a site's or
	// a mobile app's values are public addresses, and need no SSH at all.
	const addresses = stackAddresses(env, stack);
	if (addresses.length === 0) {
		logger.log(`📦 App: ${appName} on '${stage}'`);
		logger.log(`🔐 Loaded ${Object.keys(env).length} value(s) for '${stage}'`);
		return run(commandArgs, env, options.cwd);
	}

	const server = stageServer(loaded, options);
	logger.log(`📦 App: ${appName} on '${stage}' (${server.host})`);

	// The deploy's own check: SSH logs in and Docker answers, before any
	// tunnel is asked for — so a key the server refuses is said as that.
	await deps.server.check(server);

	const tunnels: Tunnel[] = [];
	const ports = new Map<string, number>();
	try {
		for (const address of addresses) {
			const published = await deps.docker.published(
				{ host: dockerHost(server) },
				stack.project,
				address.service,
				address.port,
			);
			if (published === undefined) {
				logger.log(
					`⚠️  ${address.service} is not published on the server (no running ` +
						`${stack.project} ${address.service} publishes ${address.port}), so ` +
						'it is unreachable from here; its address is passed on unchanged.',
				);
				continue;
			}
			const tunnel = await deps.server.tunnel(server, published);
			tunnels.push(tunnel);
			ports.set(`${address.service}:${address.port}`, tunnel.port);
			logger.log(`🚇 ${address.service} → 127.0.0.1:${tunnel.port} (over SSH)`);
		}

		const credentials = throughTunnels(env, stack, ports);
		logger.log(
			`🔐 Loaded ${Object.keys(credentials).length} value(s) for '${stage}'`,
		);
		return await run(commandArgs, credentials, options.cwd);
	} finally {
		await Promise.all(tunnels.map((tunnel) => tunnel.close()));
	}
}

/**
 * The command, with the values in its environment and its Credentials. A
 * Ctrl-C reaches it — it is in the terminal's process group — and this
 * process waits for it to exit rather than leaving before the tunnels close.
 */
function run(
	commandArgs: readonly [string, ...string[]],
	credentials: Record<string, string>,
	cwd: string | undefined,
): Promise<number> {
	const [cmd, ...args] = commandArgs;
	logger.log(`🚀 Running: ${commandArgs.join(' ')}`);

	const inherited = (process.env.NODE_OPTIONS ?? '')
		.replace(/--import[= ]\S+/g, '')
		.trim();
	const nodeOptions = [inherited, credentialsImport(Object.keys(credentials))]
		.filter(Boolean)
		.join(' ');

	const wait = () => {};
	process.on('SIGINT', wait);
	process.on('SIGTERM', wait);
	return new Promise<number>((resolve) => {
		const child = spawn(cmd, args, {
			...(cwd ? { cwd } : {}),
			stdio: 'inherit',
			env: { ...process.env, ...credentials, NODE_OPTIONS: nodeOptions },
		});
		child.on('close', (code, signal) => {
			resolve(code ?? 128 + (signal ? constants.signals[signal] : 0));
		});
		child.on('error', (error) => {
			logger.error(`Failed to run command: ${error.message}`);
			resolve(1);
		});
	}).finally(() => {
		process.off('SIGINT', wait);
		process.off('SIGTERM', wait);
	});
}
