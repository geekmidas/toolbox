/**
 * The Docker operations `gkm compose` needs, behind an interface.
 *
 * Small on purpose, like reconcile's: the rules about *when* each runs — the
 * registry is asked before anything is pulled, nothing is started for a tag
 * that is missing — are asserted against a fake, and this file is only the
 * wiring to the real CLI.
 *
 * Every call is an argument array. Image refs, tags and paths come from the
 * workspace, and none of them reaches a shell.
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { GkmError } from '../errors';
import { type RunOptions, run, runOutput } from '../run';

/** Where one stack lives: its compose project and the file that defines it. */
export interface StackRef {
	project: string;
	file: string;
	/**
	 * The project's own files merged over `file`, in order — its
	 * `docker-compose.<stage>.yml`, where it has one.
	 */
	overrides?: readonly string[];
	/** Where relative paths in the file resolve — the workspace root. */
	cwd: string;
	/**
	 * The Docker engine the stack runs on, as `DOCKER_HOST` names it: a
	 * deployed stage's server, `ssh://user@host`. Absent for this machine's
	 * engine — the local stage — whose environment is left as it is.
	 *
	 * Compose is a client: it reads the compose file and every `env_file` here
	 * and sends their values in the API calls that create each container. A
	 * stage's secrets therefore never land on the server as a file — they are
	 * in the container's configuration, which only the server's Docker group
	 * can read.
	 */
	host?: string;
	/**
	 * Where docker's own output goes: the terminal (the default), stderr — so
	 * a `--json` run's stdout carries only events — or nowhere.
	 */
	output?: 'inherit' | 'stderr' | 'ignore';
	/** Stops whatever docker is doing for the stack. */
	signal?: AbortSignal;
}

/** `output` as `spawn` reads it. */
const STDIO: Record<NonNullable<StackRef['output']>, RunOptions['stdio']> = {
	inherit: 'inherit',
	stderr: ['ignore', 2, 2],
	ignore: 'ignore',
};

/**
 * The environment a docker command for `engine` runs with: this process's,
 * with `DOCKER_HOST` pointing at the stack's engine when it is a server's.
 */
export function engineEnv(
	engine: Pick<StackRef, 'host'>,
	extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv | undefined {
	if (!engine.host && Object.keys(extra).length === 0) return undefined;
	return {
		...process.env,
		...extra,
		...(engine.host ? { DOCKER_HOST: engine.host } : {}),
	};
}

/** How a stack's docker commands run: where it is, where output goes. */
function runOptions(stack: StackRef, extra?: NodeJS.ProcessEnv): RunOptions {
	const env = engineEnv(stack, extra);
	return {
		cwd: stack.cwd,
		stdio: STDIO[stack.output ?? 'inherit'],
		...(env ? { env } : {}),
		...(stack.signal ? { signal: stack.signal } : {}),
	};
}

/** What a command run in a container said, whatever it exited with. */
export interface ExecResult {
	/** Its exit code — null when the service has no running container. */
	code: number | null;
	stdout: string;
	stderr: string;
}

/** The engine a call that is about no stack in particular is made against. */
export type DockerEngine = Pick<StackRef, 'host'>;

/** What the registry said about one image ref. */
export type ImageLookup =
	| { ref: string; status: 'found' }
	| { ref: string; status: 'missing' }
	| { ref: string; status: 'unreachable'; detail: string };

/** A running container that publishes a host port. */
export interface PortHolder {
	/** The container's name. */
	container: string;
	/** Its compose project and service, when compose started it. */
	project?: string;
	service?: string;
}

export interface ComposeDocker {
	/** Ask the registry whether `ref` exists, without pulling it. */
	lookup(ref: string): Promise<ImageLookup>;
	/** Build every service with a `build:` entry. */
	build(stack: StackRef, services: readonly string[]): Promise<void>;
	/** Pull the named services' images. */
	pull(stack: StackRef, services: readonly string[]): Promise<void>;
	/**
	 * Start services, detached, and wait for their health checks. With no
	 * services named, the whole stack — and anything it no longer defines is
	 * removed.
	 */
	up(stack: StackRef, services?: readonly string[]): Promise<void>;
	/** Stop the stack. Its volumes are kept. */
	down(stack: StackRef): Promise<void>;
	/** The host port a running service publishes for `inside`. */
	port(stack: StackRef, service: string, inside: number): Promise<number>;
	/**
	 * A running service's health, as its own check reports it — `healthy`,
	 * `starting`, `unhealthy` — or undefined when it is not running.
	 */
	health(stack: StackRef, service: string): Promise<string | undefined>;
	/** Copy a file out of a running service. */
	copyOut(
		stack: StackRef,
		service: string,
		from: string,
		to: string,
	): Promise<void>;
	/**
	 * Push an image built here to its registry, and return the digest the
	 * registry stored it under (`sha256:…`).
	 */
	push(stack: StackRef, ref: string): Promise<string>;
	/**
	 * What an image resolved to on the stack's engine: the registry digest a
	 * pulled image has, or the content id of one built and never pushed.
	 */
	digest(engine: DockerEngine, ref: string): Promise<string | undefined>;
	/** Create a network on the engine, unless one by that name is there. */
	ensureNetwork(engine: DockerEngine, name: string): Promise<void>;
	/** Every running container publishing `port` on the engine's host. */
	publishers(engine: DockerEngine, port: number): Promise<PortHolder[]>;
	/**
	 * Run a command in a service's running container, `input` on its stdin —
	 * how files reach a container on a server, through the engine alone.
	 */
	exec(
		stack: StackRef,
		service: string,
		command: readonly string[],
		input?: string,
	): Promise<ExecResult>;
}

/**
 * The host ports a `docker ps` Ports column publishes: `0.0.0.0:443->443/tcp,
 * [::]:443->443/tcp, 0.0.0.0:9000-9001->9000-9001/tcp`.
 */
export function publishedPorts(column: string): number[] {
	const ports = new Set<number>();
	for (const match of column.matchAll(
		/(?:[\d.]+|\[[^\]]*\]):(\d+)(?:-(\d+))?->/g,
	)) {
		const first = Number(match[1]);
		const last = match[2] ? Number(match[2]) : first;
		for (let port = first; port <= last; port++) ports.add(port);
	}
	return [...ports];
}

/** Each line `docker ps` printed, as the containers holding `port`. */
export function portHolders(output: string, port: number): PortHolder[] {
	return output
		.split('\n')
		.filter(Boolean)
		.map((line) => line.split('\t'))
		.filter(([, , , column = '']) => publishedPorts(column).includes(port))
		.map(([container = '', project, service]) => ({
			container,
			...(project ? { project } : {}),
			...(service ? { service } : {}),
		}));
}

/** How long a stack has to pass its health checks. */
const WAIT_TIMEOUT_S = 180;

/** `docker compose port` printed nothing a port can be read from. */
export class ServicePortUnknown extends GkmError {
	constructor(
		readonly service: string,
		readonly inside: number,
		readonly output: string,
	) {
		super(
			`'${service}' publishes no host port for ${inside} (docker said: ${output.trim() || 'nothing'}). Is it running? \`docker compose ps\` shows the stack.`,
		);
		this.name = 'ServicePortUnknown';
	}
}

/**
 * Whether `ref` names a registry on this machine's loopback — which the
 * daemon pulls from and pushes to over plain HTTP by default, and `docker
 * manifest inspect` reaches only when told `--insecure` (without it, a local
 * registry's image is reported as no such manifest).
 */
export function isLoopbackRegistry(ref: string): boolean {
	const first = ref.split('/')[0]!;
	if (!ref.includes('/') || !/[.:]|^localhost$/.test(first)) return false;
	const host = first.replace(/:\d+$/, '');
	return host === 'localhost' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** `docker push` finished without saying what digest the registry stored. */
export class PushDigestUnknown extends GkmError {
	constructor(
		readonly ref: string,
		readonly output: string,
	) {
		super(
			`Pushed ${ref}, but docker did not say which digest the registry stored ` +
				`(it said: ${output.trim().split('\n').slice(-3).join(' / ') || 'nothing'}). ` +
				`Check the push with \`docker buildx imagetools inspect ${ref}\`.`,
		);
		this.name = 'PushDigestUnknown';
	}
}

/** The digest `docker push` reports last: `<tag>: digest: sha256:… size: …`. */
export function pushedDigest(output: string): string | undefined {
	const matches = [...output.matchAll(/digest: (sha256:[0-9a-f]{64})/g)];
	return matches.at(-1)?.[1];
}

function compose(stack: StackRef, args: readonly string[]): string[] {
	return [
		'compose',
		'-p',
		stack.project,
		'-f',
		stack.file,
		...(stack.overrides ?? []).flatMap((file) => ['-f', file]),
		...args,
	];
}

/** Run a program and keep everything it said, whatever it exits with. */
function capture(
	command: string,
	args: readonly string[],
	options: { env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const { timeoutMs = 60_000 } = options;
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
			shell: false,
			...(options.env ? { env: options.env } : {}),
		});
		if (options.input !== undefined) child.stdin?.end(options.input);
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
		timer.unref?.();
		child.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
}

/**
 * Whether a failed `docker manifest inspect` means the tag is not there, as
 * opposed to the registry not answering.
 *
 * Read off the message because that is all the CLI gives. Anything not
 * recognisably "no such tag" is treated as the registry being unreachable:
 * a registry that refused credentials must not be reported as a tag that was
 * never pushed, or the fix offered would be the wrong one.
 */
export function isMissingManifest(output: string): boolean {
	return /no such manifest|manifest unknown|manifest for .* not found|not found: manifest/i.test(
		output,
	);
}

export const dockerCompose: ComposeDocker = {
	async lookup(ref) {
		const { code, stdout, stderr } = await capture('docker', [
			'manifest',
			'inspect',
			...(isLoopbackRegistry(ref) ? ['--insecure'] : []),
			ref,
		]);
		if (code === 0) return { ref, status: 'found' };

		const output = `${stderr}\n${stdout}`.trim();
		return isMissingManifest(output)
			? { ref, status: 'missing' }
			: { ref, status: 'unreachable', detail: output };
	},

	async build(stack, services) {
		await run(
			'docker',
			compose(stack, ['build', ...services]),
			runOptions(stack, { ...process.env, DOCKER_BUILDKIT: '1' }),
		);
	},

	async pull(stack, services) {
		await run(
			'docker',
			compose(stack, ['pull', ...services]),
			runOptions(stack),
		);
	},

	async up(stack, services) {
		await run(
			'docker',
			compose(stack, [
				'up',
				'-d',
				'--wait',
				`--wait-timeout=${WAIT_TIMEOUT_S}`,
				// Only when the whole stack is asked for: starting the databases
				// first must not remove the apps an earlier run left running.
				...(services ? [] : ['--remove-orphans']),
				...(services ?? []),
			]),
			runOptions(stack),
		);
	},

	async down(stack) {
		await run('docker', compose(stack, ['down']), runOptions(stack));
	},

	async port(stack, service, inside) {
		const env = engineEnv(stack);
		const output = await runOutput(
			'docker',
			compose(stack, ['port', service, String(inside)]),
			{
				cwd: stack.cwd,
				...(env ? { env } : {}),
				...(stack.signal ? { signal: stack.signal } : {}),
			},
		);
		// `127.0.0.1:54321` — the part after the last colon is the host port.
		const port = Number(output.trim().split(':').pop());
		if (!Number.isInteger(port) || port <= 0) {
			throw new ServicePortUnknown(service, inside, output);
		}
		return port;
	},

	async health(stack, service) {
		const env = engineEnv(stack);
		const { code, stdout } = await capture(
			'docker',
			compose(stack, ['ps', '--format', '{{.Health}}', service]),
			env ? { env } : {},
		);
		if (code !== 0) return undefined;
		return stdout.trim().split('\n')[0] || undefined;
	},

	async copyOut(stack, service, from, to) {
		await mkdir(dirname(to), { recursive: true });
		await run(
			'docker',
			compose(stack, ['cp', `${service}:${from}`, to]),
			runOptions(stack),
		);
	},

	async push(stack, ref) {
		// What it printed is read back for the digest; its errors still reach
		// the terminal.
		const output = await runOutput('docker', ['push', ref], {
			cwd: stack.cwd,
			...(stack.signal ? { signal: stack.signal } : {}),
		});
		const digest = pushedDigest(output);
		if (!digest) throw new PushDigestUnknown(ref, output);
		return digest;
	},

	async digest(engine, ref) {
		const env = engineEnv(engine);
		const { code, stdout } = await capture(
			'docker',
			['image', 'inspect', '--format={{json .RepoDigests}} {{.Id}}', ref],
			env ? { env } : {},
		);
		if (code !== 0) return undefined;

		const [json = '[]', id] = stdout.trim().split(' ');
		const repository = ref.split('@')[0]!.replace(/:[\w][\w.-]*$/, '');
		try {
			const digests = JSON.parse(json) as unknown;
			const match = Array.isArray(digests)
				? digests.find(
						(entry): entry is string =>
							typeof entry === 'string' && entry.startsWith(`${repository}@`),
					)
				: undefined;
			if (match) return match.slice(repository.length + 1);
		} catch {
			// Fall through to the content id.
		}
		return id || undefined;
	},

	async ensureNetwork(engine, name) {
		const env = engineEnv(engine);
		const options = env ? { env } : {};
		const { code } = await capture(
			'docker',
			['network', 'inspect', name],
			options,
		);
		if (code === 0) return;
		const created = await capture(
			'docker',
			['network', 'create', name],
			options,
		);
		// Another run may have created it between the two calls.
		if (created.code !== 0 && !/already exists/.test(created.stderr)) {
			throw new NetworkCreateFailed(name, created.stderr);
		}
	},

	async publishers(engine, port) {
		const env = engineEnv(engine);
		const { stdout } = await capture(
			'docker',
			[
				'ps',
				'--format',
				'{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}\t{{.Ports}}',
			],
			env ? { env } : {},
		);
		return portHolders(stdout, port);
	},

	async exec(stack, service, command, input) {
		const env = engineEnv(stack);
		const options = env ? { env } : {};
		// By its compose labels, so it needs no compose file: `--down` reaches
		// the shared edge with nothing but its project's name.
		const { stdout: ids } = await capture(
			'docker',
			[
				'ps',
				'-q',
				'--filter',
				`label=com.docker.compose.project=${stack.project}`,
				'--filter',
				`label=com.docker.compose.service=${service}`,
			],
			options,
		);
		const container = ids.trim().split('\n')[0];
		if (!container) {
			return { code: null, stdout: '', stderr: `${service} is not running` };
		}
		return capture(
			'docker',
			['exec', ...(input === undefined ? [] : ['-i']), container, ...command],
			{ ...options, ...(input === undefined ? {} : { input }) },
		);
	},
};

/** `docker network create` failed. */
export class NetworkCreateFailed extends GkmError {
	constructor(
		readonly network: string,
		readonly output: string,
	) {
		super(
			`Could not create the Docker network '${network}' (docker said: ${output.trim() || 'nothing'}). Create it by hand with \`docker network create ${network}\` and run again.`,
		);
		this.name = 'NetworkCreateFailed';
	}
}
