/**
 * `gkm db:tunnel --stage <stage> [construct]`: a deployed compose stage's
 * Postgres, on this machine's loopback, and each database's owner login to
 * sign in to it with — for a SQL client, a one-off fix, a look at the data.
 *
 * The tunnel is the deploy's own: SSH on the deploy's login to the port the
 * server publishes Postgres on, its loopback alone. The owner URL is the one
 * the deploy migrates with, derived from the stage's secrets the way the
 * deploy derives it — nothing is stored, and nothing is written to disk.
 *
 * It is the owner, not the app's login, because that is what a person
 * changing the schema or its data by hand needs; it is printed, not injected,
 * because a GUI client is not a process gkm starts. `gkm exec --stage` stays
 * the app's login: what a script runs as is what the app runs as.
 */

import { providedKeyFor } from '@geekmidas/manifest';
import { dockerHost } from '../compose/server.js';
import type { ComposeStack } from '../compose/stack.js';
import { LOOPBACK_SERVICES } from '../compose/stack.js';
import { GkmError } from '../errors';
import { primaryPortKey } from '../reconcile/containers.js';
import { envFor, isDatabase } from '../reconcile/env.js';
import {
	defaultStageExecDeps,
	ExecNotConfirmed,
	loadStage,
	type StageExecDeps,
	type StageExecOptions,
	stageServer,
} from './stage.js';

const logger = console;

/** The stage's stack runs no Postgres: there is nothing to tunnel to. */
export class StageHasNoDatabase extends GkmError {
	constructor(readonly stage: string) {
		super(
			`'${stage}' runs no Postgres, so there is no database to tunnel to. ` +
				'Declare a Database construct and deploy the stage.',
		);
		this.name = 'StageHasNoDatabase';
	}
}

/** The construct asked for is not one of the stage's databases. */
export class DatabaseNotInStage extends GkmError {
	constructor(
		readonly stage: string,
		readonly construct: string,
		readonly databases: readonly string[],
	) {
		super(
			`'${construct}' is not a database '${stage}' runs. Its databases are ` +
				`${databases.join(', ')}: gkm db:tunnel --stage ${stage} ` +
				`${databases[0] ?? '<construct>'}.`,
		);
		this.name = 'DatabaseNotInStage';
	}
}

/** The server publishes no Postgres: the stack is not running there. */
export class DatabaseNotPublished extends GkmError {
	constructor(
		readonly stage: string,
		readonly project: string,
	) {
		super(
			`No running ${project} postgres publishes ${LOOPBACK_SERVICES.postgres} ` +
				`on '${stage}'s server, so there is nothing to tunnel to. Deploy the ` +
				`stage (gkm deploy --stage ${stage}), then run this again.`,
		);
		this.name = 'DatabaseNotPublished';
	}
}

/** A database's owner login, as this machine reaches it. */
export interface OwnerLogin {
	/** The construct's id. */
	construct: string;
	/** The key the deploy's migrations read it from. */
	key: string;
	url: string;
}

/** A login's URL as a SQL client's form asks for it, field by field. */
export function loginFields(url: string): [string, string][] {
	const parsed = new URL(url);
	return [
		['host', parsed.hostname],
		['port', parsed.port],
		['database', decodeURIComponent(parsed.pathname.slice(1))],
		['user', decodeURIComponent(parsed.username)],
		['password', decodeURIComponent(parsed.password)],
	];
}

/**
 * Each database's owner URL — every one, or the construct asked for — on
 * the port this machine reaches the stack's Postgres by: the same values the
 * deploy's migrations connect with (`migrateAndSeed`), from the same
 * derivation.
 *
 * @throws {DatabaseNotInStage}
 */
export function ownerLogins(
	stack: Pick<ComposeStack, 'stage' | 'plan' | 'resolution'>,
	port: number,
	construct?: string,
): OwnerLogin[] {
	const env = envFor(stack.plan, {
		...stack.resolution,
		ports: { [primaryPortKey('postgres')]: port },
	});
	const logins = stack.plan.resources
		.filter((resource) => isDatabase(resource.kind))
		.map((resource) => {
			const key = providedKeyFor(resource.id, resource.kind, 'ownerUrl');
			// A database whose roles are not split has no owner: its one login
			// is the URL itself, and that is the one to sign in with.
			const url = env[key] ?? env[resource.envKey];
			return url ? { construct: resource.id, key, url } : undefined;
		})
		.filter((login): login is OwnerLogin => login !== undefined);

	if (construct === undefined) return logins;
	const asked = logins.filter((login) => login.construct === construct);
	if (asked.length === 0) {
		throw new DatabaseNotInStage(
			stack.stage,
			construct,
			logins.map((login) => login.construct),
		);
	}
	return asked;
}

export interface DbTunnelOptions
	extends Pick<
		StageExecOptions,
		'stage' | 'profile' | 'sshUser' | 'yes' | 'cwd'
	> {
	/** One database construct, by id. Every one when absent. */
	construct?: string;
}

export interface DbTunnelDeps extends StageExecDeps {
	/** Resolves when the tunnel should close: Ctrl-C, by default. */
	held: () => Promise<void>;
}

/** Until the person presses Ctrl-C, or the process is told to stop. */
function untilInterrupted(): Promise<void> {
	return new Promise((resolve) => {
		const stop = () => {
			process.off('SIGINT', stop);
			process.off('SIGTERM', stop);
			resolve();
		};
		process.on('SIGINT', stop);
		process.on('SIGTERM', stop);
	});
}

export const defaultDbTunnelDeps: DbTunnelDeps = {
	...defaultStageExecDeps,
	held: untilInterrupted,
};

/**
 * Open a tunnel to the stage's Postgres, print each database's owner URL
 * through it, and hold it open until `deps.held` resolves. The tunnel is
 * closed however that ends.
 *
 * @throws {StageHasNoDatabase}, {DatabaseNotInStage}, {DatabaseNotPublished},
 *   {ExecNotConfirmed}, {ExecStageNotComposed}, {ExecStageNotDeployed},
 *   {ComposeServerUnreachable}
 */
export async function dbTunnel(
	options: DbTunnelOptions,
	deps: DbTunnelDeps = defaultDbTunnelDeps,
): Promise<OwnerLogin[]> {
	const { stage } = options;
	const loaded = await loadStage(options, deps.env);
	const { stack } = loaded;
	if (!stack.infra.includes('postgres')) throw new StageHasNoDatabase(stage);
	// Asked here, before anything is reached: an unknown construct is said
	// without an SSH login. The port is a placeholder until the tunnel opens.
	ownerLogins(stack, LOOPBACK_SERVICES.postgres, options.construct);

	if (loaded.protectedStage && !options.yes) {
		const question = `'${stage}' is a protected stage. Open a tunnel to its database as its owner?`;
		if (!(await deps.confirm(question))) throw new ExecNotConfirmed(stage);
	}

	const server = stageServer(loaded, options);
	await deps.server.check(server);

	const published = await deps.docker.published(
		{ host: dockerHost(server) },
		stack.project,
		'postgres',
		LOOPBACK_SERVICES.postgres,
	);
	if (published === undefined) {
		throw new DatabaseNotPublished(stage, stack.project);
	}

	const tunnel = await deps.server.tunnel(server, published);
	try {
		const logins = ownerLogins(stack, tunnel.port, options.construct);
		logger.log(
			`🚇 '${stage}' postgres → 127.0.0.1:${tunnel.port} (over SSH to ${server.host})`,
		);
		for (const login of logins) {
			logger.log(`\n🔑 ${login.construct} (${login.key})`);
			logger.log(`   ${login.url}`);
			for (const [field, value] of loginFields(login.url)) {
				logger.log(`   ${`${field}:`.padEnd(10)}${value}`);
			}
		}
		logger.log('\nThe tunnel is open. Press Ctrl-C to close it.');
		await deps.held();
		return logins;
	} finally {
		await tunnel.close();
	}
}
