/**
 * Where a deployed compose stage runs: its server, reached over SSH.
 *
 * gkm never runs on the server. It runs where the deploy is started — a CI
 * runner, a developer's machine — and drives the server's Docker engine over
 * SSH (`DOCKER_HOST=ssh://user@host`), so the server holds Docker, an SSH
 * login and nothing else: no gkm, no checkout, no cloud credentials.
 *
 * ```ts
 * deploy: { compose: { server: { production: { user: 'deploy' } } } }
 * ```
 *
 * The host is the stage's `GKM_SERVER_IPV4` secret — the address its DNS
 * records already point at — unless `host` names another. The local stage is
 * never given one: it runs on this machine's Docker.
 *
 * What the deploy needs from inside the server — Postgres and MinIO, published
 * on the server's loopback alone — it reaches through an SSH tunnel on the same
 * login, so neither is ever published publicly.
 */

import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { GkmError } from '../errors';
import type { ComposeServerConfig } from '../workspace/types.js';
import { SERVER_IPV4_KEY } from './dnsConfig';

/** A stage's server, as SSH reaches it. */
export interface ComposeServer {
	user: string;
	host: string;
	port: number;
}

/** A deployed compose stage with nowhere to run. */
export class ComposeServerMissing extends GkmError {
	constructor(
		readonly stage: string,
		readonly missing: 'config' | 'host',
	) {
		super(
			missing === 'config'
				? `'${stage}' is a deployed stage, and gkm deploys it to its server's ` +
						"Docker over SSH — it never starts a deployed stage on this machine's " +
						`Docker. Name the login in gkm.config.ts: deploy: { compose: { server: ` +
						`{ ${stage}: { user: 'deploy' } } } } — the host is the stage's ` +
						`${SERVER_IPV4_KEY} secret (gkm secrets:set ${SERVER_IPV4_KEY} '<ip>' ` +
						`--stage ${stage}), or set host there too.`
				: `deploy.compose.server.${stage} names no host, and '${stage}' has no ` +
						`${SERVER_IPV4_KEY} secret to default to. Set it: gkm secrets:set ` +
						`${SERVER_IPV4_KEY} '<ip>' --stage ${stage} — or set ` +
						`deploy.compose.server.${stage}.host.`,
		);
		this.name = 'ComposeServerMissing';
	}
}

/** SSH to the stage's server failed before anything was changed there. */
export class ComposeServerUnreachable extends GkmError {
	constructor(
		readonly target: string,
		readonly stderr: string,
	) {
		super(
			`Could not reach Docker on ${target} over SSH (ssh said: ${stderr.trim() || 'nothing'}). ` +
				`Check that \`ssh ${target} docker version\` works from here: the host key in ` +
				'~/.ssh/known_hosts, the key in your agent or ~/.ssh/config, and the user in ' +
				"the server's docker group.",
		);
		this.name = 'ComposeServerUnreachable';
	}
}

/** An SSH tunnel to a port on the server's loopback did not open. */
export class ComposeTunnelFailed extends GkmError {
	constructor(
		readonly target: string,
		readonly remotePort: number,
		readonly stderr: string,
	) {
		super(
			`Could not open an SSH tunnel to 127.0.0.1:${remotePort} on ${target} ` +
				`(ssh said: ${stderr.trim() || 'nothing'}). The server's sshd must allow ` +
				'TCP forwarding (AllowTcpForwarding yes, the default) for the deploy user.',
		);
		this.name = 'ComposeTunnelFailed';
	}
}

/**
 * The stage's server: its login from `deploy.compose.server.<stage>`, its
 * host from there or the stage's `GKM_SERVER_IPV4`. Undefined for the local
 * stage, which runs on this machine.
 *
 * @throws {ComposeServerMissing} for a deployed stage with no login or host
 */
export function composeServer(options: {
	stage: string;
	local: boolean;
	config: Readonly<Record<string, ComposeServerConfig>> | undefined;
	custom: Readonly<Record<string, string>> | undefined;
}): ComposeServer | undefined {
	const { stage } = options;
	if (options.local) return undefined;
	const config = options.config?.[stage];
	if (!config) throw new ComposeServerMissing(stage, 'config');
	const host = config.host ?? options.custom?.[SERVER_IPV4_KEY]?.trim();
	if (!host) throw new ComposeServerMissing(stage, 'host');
	return { user: config.user, host, port: config.port ?? 22 };
}

/** `user@host`, as a person types it after `ssh`. */
export function sshTarget(server: ComposeServer): string {
	return `${server.user}@${server.host}`;
}

/** The server's Docker engine, as `DOCKER_HOST` names it. */
export function dockerHost(server: ComposeServer): string {
	const host = server.host.includes(':') ? `[${server.host}]` : server.host;
	return `ssh://${server.user}@${host}${server.port === 22 ? '' : `:${server.port}`}`;
}

/** The arguments every `ssh` gkm runs starts with: no prompt, ever. */
function sshArgs(server: ComposeServer): string[] {
	return [
		'-o',
		'BatchMode=yes',
		'-o',
		'ConnectTimeout=20',
		'-p',
		String(server.port),
		sshTarget(server),
	];
}

/** A local port forwarded to one on the server's loopback. */
export interface Tunnel {
	/** The port on this machine's loopback. */
	port: number;
	close(): Promise<void>;
}

/** What the deploy does on a stage's server beyond Docker. */
export interface ServerAccess {
	/**
	 * Whether SSH logs in and Docker answers there — read-only: `docker
	 * version`, nothing else.
	 */
	check(server: ComposeServer): Promise<void>;
	/** Forward a free local port to `remotePort` on the server's loopback. */
	tunnel(server: ComposeServer, remotePort: number): Promise<Tunnel>;
}

async function freeLocalPort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	await new Promise((resolve) => server.close(resolve));
	if (!address || typeof address === 'string') return 0;
	return address.port;
}

function connects(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: '127.0.0.1', port });
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('error', () => resolve(false));
	});
}

/** The real one: the system's `ssh`, with the user's keys and known hosts. */
export const sshAccess: ServerAccess = {
	check(server) {
		return new Promise((resolve, reject) => {
			const child = spawn(
				'ssh',
				[
					...sshArgs(server),
					'docker',
					'version',
					'--format',
					'{{.Server.Version}}',
				],
				{ stdio: ['ignore', 'ignore', 'pipe'] },
			);
			let stderr = '';
			child.stderr.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on('error', (error) =>
				reject(new ComposeServerUnreachable(sshTarget(server), error.message)),
			);
			child.on('close', (code) =>
				code === 0
					? resolve()
					: reject(new ComposeServerUnreachable(sshTarget(server), stderr)),
			);
		});
	},

	async tunnel(server, remotePort) {
		const port = await freeLocalPort();
		const child = spawn(
			'ssh',
			[
				'-N',
				'-o',
				'ExitOnForwardFailure=yes',
				// A connection of its own: through a shared master (ControlMaster
				// in ~/.ssh/config) the forward would be the master's, and this
				// process — the tunnel's lifetime — would exit at once.
				'-o',
				'ControlPath=none',
				'-L',
				`127.0.0.1:${port}:127.0.0.1:${remotePort}`,
				...sshArgs(server),
			],
			{ stdio: ['ignore', 'ignore', 'pipe'] },
		);
		let stderr = '';
		let exited = false;
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on('exit', () => {
			exited = true;
		});
		child.on('error', (error) => {
			exited = true;
			stderr += error.message;
		});
		const close = async () => {
			if (exited) return;
			const gone = new Promise((resolve) => child.once('exit', resolve));
			child.kill('SIGTERM');
			await gone;
		};

		// Open once a connection to it is accepted — ssh only listens once
		// it has logged in and set the forward up.
		for (let attempt = 0; attempt < 150; attempt++) {
			if (exited) break;
			if (await connects(port)) return { port, close };
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		await close();
		throw new ComposeTunnelFailed(sshTarget(server), remotePort, stderr);
	},
};
