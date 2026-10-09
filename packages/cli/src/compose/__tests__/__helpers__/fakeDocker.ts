import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
	ComposeDocker,
	ExecResult,
	ImageLookup,
	PortHolder,
	StackRef,
} from '../../docker';
import type { ServerAccess } from '../../server';

/**
 * Docker, the registry and the health probe as recorders, for asserting the
 * order a stack is brought up in without a daemon.
 */

export interface Call {
	op: string;
	args?: unknown;
	/** An `up` of the shared edge rather than the stack. */
	edge?: boolean;
	/** The engine the call was made against — `DOCKER_HOST` — when not this machine's. */
	host?: string;
}

/** `{ host }` for a call against a server's engine, nothing for this machine's. */
const on = (engine: { host?: string }) =>
	engine.host ? { host: engine.host } : {};

export function fakeDocker(
	options: {
		registry?: readonly string[];
		/** What holds each host port, as `docker ps` would say. */
		holders?: Readonly<Record<number, readonly PortHolder[]>>;
		/** What a command run in a container answers — exit 0 by default. */
		exec?: (
			stack: StackRef,
			service: string,
			command: readonly string[],
			input?: string,
		) => ExecResult | undefined;
	} = {},
) {
	const calls: Call[] = [];
	const docker: ComposeDocker = {
		async lookup(ref): Promise<ImageLookup> {
			calls.push({ op: 'lookup', args: ref });
			return options.registry?.includes(ref)
				? { ref, status: 'found' }
				: { ref, status: 'missing' };
		},
		async build(stack: StackRef, services) {
			calls.push({ op: 'build', args: [...services], ...on(stack) });
		},
		async pull(stack, services) {
			calls.push({ op: 'pull', args: [...services], ...on(stack) });
		},
		async up(stack, services) {
			calls.push({
				op: 'up',
				args: services ? [...services] : 'all',
				...(stack.project === 'gkm-edge' ? { edge: true } : {}),
				...on(stack),
			});
		},
		async down(stack) {
			calls.push({ op: 'down', args: stack.project, ...on(stack) });
		},
		async port(stack, service, inside) {
			calls.push({ op: 'port', args: [service, inside], ...on(stack) });
			return 55432;
		},
		async health(stack, service) {
			calls.push({ op: 'health', args: service, ...on(stack) });
			return 'healthy';
		},
		async copyOut(stack, service, from) {
			calls.push({ op: 'copyOut', args: [service, from], ...on(stack) });
		},
		async push(stack, ref) {
			calls.push({ op: 'push', args: ref, ...on(stack) });
			return fakeDigest(ref);
		},
		async digest(_engine, ref) {
			return `sha256:${ref.length.toString(16).padStart(4, '0')}`;
		},
		async ensureNetwork(engine, name) {
			calls.push({ op: 'network', args: name, ...on(engine) });
		},
		async publishers(_engine, port) {
			return [...(options.holders?.[port] ?? [])];
		},
		async exec(stack, service, command, input): Promise<ExecResult> {
			calls.push({
				op: 'exec',
				args: { project: stack.project, service, command: [...command], input },
				...on(stack),
			});
			return (
				options.exec?.(stack, service, command, input) ?? {
					code: 0,
					stdout: '',
					stderr: '',
				}
			);
		},
		async container(engine, project, service) {
			calls.push({ op: 'container', args: [project, service], ...on(engine) });
			return { id: `${project}-${service}-1`, image: `${project}-${service}` };
		},
		async runOnce(engine, run) {
			calls.push({ op: 'runOnce', args: run, ...on(engine) });
			return 0;
		},
	};
	return { docker, calls, ops: () => calls.map((call) => call.op) };
}

/** The digest the fake registry stores a pushed `ref` under: 64 hex. */
export function fakeDigest(ref: string): string {
	return `sha256:${createHash('sha256').update(ref).digest('hex')}`;
}

/** A probe every app answers 200 to, recorded beside docker's calls. */
export function answering(calls: Call[]) {
	return async ({ url }: { url: string }) => {
		calls.push({ op: 'probe', args: url });
		return 200;
	};
}

/** The local port a fake tunnel hands back: not the one the server published. */
export const TUNNEL_PORT = 61_432;

/**
 * A server reached over SSH, as a recorder: the check answers, and each
 * tunnel is opened — and closed — in `calls`.
 */
export function fakeServer(
	calls: Call[],
	options: { unreachable?: Error } = {},
): ServerAccess {
	return {
		async check(server) {
			calls.push({
				op: 'ssh',
				args: `${server.user}@${server.host}:${server.port}`,
			});
			if (options.unreachable) throw options.unreachable;
		},
		async tunnel(server, remotePort) {
			calls.push({
				op: 'tunnel',
				args: [`${server.user}@${server.host}`, remotePort],
			});
			return {
				port: TUNNEL_PORT,
				close: async () => {
					calls.push({ op: 'tunnel-closed', args: remotePort });
				},
			};
		},
	};
}

/**
 * The shared edge's volumes as a directory here: each command the deploy
 * runs in the edge's container is run by this machine's `sh`, with the
 * container's `/etc/gkm-edge` at `root` — so what is asserted is what the
 * real commands leave behind.
 */
export function edgeOnDisk(root: string) {
	mkdirSync(join(root, 'dynamic'), { recursive: true });
	mkdirSync(join(root, 'certs'), { recursive: true });
	return (
		_stack: StackRef,
		_service: string,
		command: readonly string[],
		input?: string,
	): ExecResult => {
		const [program, ...args] = command.map((arg) =>
			arg.replaceAll('/etc/gkm-edge', root),
		);
		const result = spawnSync(program!, args, {
			encoding: 'utf-8',
			...(input === undefined ? {} : { input }),
		});
		return {
			code: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	};
}
