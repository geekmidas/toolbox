import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A server for an end-to-end deploy, on this machine: Docker-in-Docker with
 * sshd, a `deploy` user in its docker group, and nothing else — no gkm, no
 * Node, no checkout, no credentials. What a deployed compose stage's server
 * is, so the deploy can reach it the one way it reaches a real one: Docker
 * over SSH.
 *
 * Its SSH port, and every port the stacks on it publish, are on this
 * machine's loopback. SSH is pinned to the host key the server generated,
 * through an `ssh` on PATH that reads this server's own config — the user's
 * `~/.ssh` is never read or written.
 */

export const DIND_IMAGE = 'docker:28.5.1-dind';

/**
 * The server's image: Docker-in-Docker with sshd already installed. Built
 * once on this machine and reused — a boot that installed it fetched the
 * Alpine index and package from the network on every run, which under load
 * was the slow, and sometimes failing, part of starting a server.
 */
const SERVER_DOCKERFILE = `FROM ${DIND_IMAGE}
RUN apk add --no-cache openssh-server
`;

/** Tagged by what it is built from, so a change to it is a new image. */
export const SERVER_IMAGE = `gkm-e2e-server:${createHash('sha256')
	.update(SERVER_DOCKERFILE)
	.digest('hex')
	.slice(0, 12)}`;

/** What the server runs at boot: sshd, then Docker. */
const BOOT = `set -e
ssh-keygen -A >/dev/null
addgroup -S docker 2>/dev/null || true
adduser -D -s /bin/sh deploy
addgroup deploy docker
# Not locked: sshd refuses a locked account even a key.
sed -i 's/^deploy:!/deploy:*/' /etc/shadow
mkdir -p /home/deploy/.ssh
printf '%s\\n' "$AUTHORIZED_KEY" > /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
cat > /etc/ssh/sshd_config <<'CFG'
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowTcpForwarding yes
MaxSessions 100
MaxStartups 100:30:200
SetEnv PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CFG
/usr/sbin/sshd
exec dockerd-entrypoint.sh dockerd --host=unix:///var/run/docker.sock --group=docker
`;

export interface SshServer {
	/** The container this machine's Docker runs it as. */
	name: string;
	user: string;
	host: string;
	sshPort: number;
	/** `DOCKER_HOST` for its engine. */
	dockerHost: string;
	/** Put first on a child's PATH: the `ssh` that knows this server. */
	bin: string;
	/** A child's environment, with that PATH. */
	env(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
	/** `docker …` against its engine, over SSH. */
	docker(args: readonly string[]): Promise<string>;
	/** A command run on the server itself, as root — for what the test asks. */
	shell(script: string): Promise<string>;
	stop(): Promise<void>;
}

/** A command the server's setup ran failed. */
export class SshServerCommandFailed extends Error {
	constructor(
		readonly command: string,
		readonly code: number | null,
		readonly output: string,
	) {
		super(`${command} exited ${code}:\n${output.slice(-4000)}`);
		this.name = 'SshServerCommandFailed';
	}
}

/** The server's container stopped before sshd and Docker were up. */
export class SshServerExited extends Error {
	constructor(
		readonly container: string,
		readonly logs: string,
	) {
		super(
			`${container} exited while it booted, before sshd and Docker were up. Its log:\n${logs.slice(-4000)}`,
		);
		this.name = 'SshServerExited';
	}
}

/** The server's sshd or Docker was not up within the wait. */
export class SshServerNotReady extends Error {
	constructor(
		readonly container: string,
		readonly waitedMs: number,
		readonly logs: string,
	) {
		super(
			`${container} did not start sshd and Docker within ${waitedMs / 1000}s. Its log:\n${logs.slice(-4000)}`,
		);
		this.name = 'SshServerNotReady';
	}
}

/** How long a booted server has to answer: sshd and dockerd, nothing pulled. */
const READY_WITHIN_MS = 120_000;

function run(
	command: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		child.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0
				? resolve(output)
				: reject(
						new SshServerCommandFailed(
							`${command} ${args.join(' ')}`,
							code,
							output,
						),
					),
		);
	});
}

/**
 * The server's image, built from {@link SERVER_DOCKERFILE} the first time and
 * found by its tag after that. Its context is an empty directory: nothing of
 * the run — the deploy key least of all — is sent to the builder.
 */
async function serverImage(dir: string): Promise<string> {
	const present = await run('docker', ['image', 'inspect', SERVER_IMAGE]).then(
		() => true,
		() => false,
	);
	if (present) return SERVER_IMAGE;
	const context = join(dir, 'image');
	mkdirSync(context, { recursive: true });
	writeFileSync(join(context, 'Dockerfile'), SERVER_DOCKERFILE);
	await run('docker', ['build', '--quiet', '-t', SERVER_IMAGE, context]);
	return SERVER_IMAGE;
}

/** Start a server, publishing `ports` at the same numbers on loopback. */
export async function startSshServer(options: {
	dir: string;
	ports: readonly number[];
	env: NodeJS.ProcessEnv;
}): Promise<SshServer> {
	const { dir } = options;
	const name = `gkm-e2e-server-${randomBytes(3).toString('hex')}`;
	mkdirSync(dir, { recursive: true });
	const key = join(dir, 'deploy_key');
	await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]);
	writeFileSync(join(dir, 'boot.sh'), BOOT);
	const image = await serverImage(dir);

	// Not `--rm`: a server whose boot failed is still there to say why, and
	// `stop` removes it either way.
	await run('docker', [
		'run',
		'-d',
		'--privileged',
		'--name',
		name,
		'-e',
		'DOCKER_TLS_CERTDIR=',
		'-e',
		`AUTHORIZED_KEY=${readFileSync(`${key}.pub`, 'utf-8').trim()}`,
		'-v',
		`${join(dir, 'boot.sh')}:/boot.sh:ro`,
		'-p',
		'127.0.0.1::22',
		...options.ports.flatMap((port) => ['-p', `127.0.0.1:${port}:${port}`]),
		'--entrypoint',
		'sh',
		image,
		'/boot.sh',
	]);

	const shell = (script: string) =>
		run('docker', ['exec', name, 'sh', '-c', script]);
	const stop = async () => {
		await run('docker', ['rm', '-f', '-v', name]).catch(() => '');
	};

	const logs = () => run('docker', ['logs', name]).catch((e) => String(e));
	const running = () =>
		run('docker', ['inspect', '-f', '{{.State.Running}}', name]).then(
			(said) => said.trim() === 'true',
			() => false,
		);

	try {
		// sshd once it has written its pid — `pgrep -f` matched the shell
		// asking — and Docker once it answers. A deadline, not a number of
		// attempts: under load each `docker exec` takes a while itself.
		const deadline = Date.now() + READY_WITHIN_MS;
		let ready = false;
		while (!ready) {
			ready = await shell(
				'test -s /var/run/sshd.pid && docker version >/dev/null 2>&1',
			).then(
				() => true,
				() => false,
			);
			if (ready) break;
			if (!(await running())) throw new SshServerExited(name, await logs());
			if (Date.now() > deadline) {
				throw new SshServerNotReady(name, READY_WITHIN_MS, await logs());
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		const sshPort = Number(
			(await run('docker', ['port', name, '22'])).trim().split(':').pop(),
		);
		const hostKey = (await shell('cat /etc/ssh/ssh_host_ed25519_key.pub'))
			.trim()
			.split(' ')
			.slice(0, 2)
			.join(' ');
		writeFileSync(
			join(dir, 'known_hosts'),
			`[127.0.0.1]:${sshPort} ${hostKey}\n`,
		);
		writeFileSync(
			join(dir, 'ssh_config'),
			`Host *
  IdentityFile ${key}
  IdentitiesOnly yes
  UserKnownHostsFile ${join(dir, 'known_hosts')}
  StrictHostKeyChecking yes
  BatchMode yes
  ControlMaster auto
  ControlPath /tmp/gkm-e2e-%C
  ControlPersist 2m
`,
		);
		const bin = join(dir, 'bin');
		mkdirSync(bin, { recursive: true });
		writeFileSync(
			join(bin, 'ssh'),
			`#!/bin/sh\nexec /usr/bin/ssh -F '${join(dir, 'ssh_config')}' "$@"\n`,
		);
		chmodSync(join(bin, 'ssh'), 0o755);

		const dockerHost = `ssh://deploy@127.0.0.1:${sshPort}`;
		const env = (extra: NodeJS.ProcessEnv = {}) => ({
			...options.env,
			...extra,
			PATH: `${bin}:${options.env.PATH ?? process.env.PATH}`,
		});
		return {
			name,
			user: 'deploy',
			host: '127.0.0.1',
			sshPort,
			dockerHost,
			bin,
			env,
			docker: (args) => run('docker', args, env({ DOCKER_HOST: dockerHost })),
			shell,
			stop,
		};
	} catch (error) {
		await stop();
		throw error;
	}
}
