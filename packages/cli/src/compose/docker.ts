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
import { run, runOutput } from '../run';

/** Where one stack lives: its compose project and the file that defines it. */
export interface StackRef {
	project: string;
	file: string;
	/** Where relative paths in the file resolve — the workspace root. */
	cwd: string;
}

/** What the registry said about one image ref. */
export type ImageLookup =
	| { ref: string; status: 'found' }
	| { ref: string; status: 'missing' }
	| { ref: string; status: 'unreachable'; detail: string };

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
	/** Copy a file out of a running service. */
	copyOut(
		stack: StackRef,
		service: string,
		from: string,
		to: string,
	): Promise<void>;
	/**
	 * What an image resolved to: the registry digest a pulled image has, or
	 * the content id of one built here and never pushed.
	 */
	digest(ref: string): Promise<string | undefined>;
}

/** How long a stack has to pass its health checks. */
const WAIT_TIMEOUT_S = 180;

/** `docker compose port` printed nothing a port can be read from. */
export class ServicePortUnknown extends Error {
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

function compose(stack: StackRef, args: readonly string[]): string[] {
	return ['compose', '-p', stack.project, '-f', stack.file, ...args];
}

/** Run a program and keep everything it said, whatever it exits with. */
function capture(
	command: string,
	args: readonly string[],
	timeoutMs = 60_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: false,
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
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
			ref,
		]);
		if (code === 0) return { ref, status: 'found' };

		const output = `${stderr}\n${stdout}`.trim();
		return isMissingManifest(output)
			? { ref, status: 'missing' }
			: { ref, status: 'unreachable', detail: output };
	},

	async build(stack, services) {
		await run('docker', compose(stack, ['build', ...services]), {
			cwd: stack.cwd,
			env: { ...process.env, DOCKER_BUILDKIT: '1' },
		});
	},

	async pull(stack, services) {
		await run('docker', compose(stack, ['pull', ...services]), {
			cwd: stack.cwd,
		});
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
			{ cwd: stack.cwd },
		);
	},

	async down(stack) {
		await run('docker', compose(stack, ['down']), { cwd: stack.cwd });
	},

	async port(stack, service, inside) {
		const output = await runOutput(
			'docker',
			compose(stack, ['port', service, String(inside)]),
			{ cwd: stack.cwd },
		);
		// `127.0.0.1:54321` — the part after the last colon is the host port.
		const port = Number(output.trim().split(':').pop());
		if (!Number.isInteger(port) || port <= 0) {
			throw new ServicePortUnknown(service, inside, output);
		}
		return port;
	},

	async copyOut(stack, service, from, to) {
		await mkdir(dirname(to), { recursive: true });
		await run('docker', compose(stack, ['cp', `${service}:${from}`, to]), {
			cwd: stack.cwd,
		});
	},

	async digest(ref) {
		const { code, stdout } = await capture('docker', [
			'image',
			'inspect',
			'--format={{json .RepoDigests}} {{.Id}}',
			ref,
		]);
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
};
