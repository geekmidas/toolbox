import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

/** What the server runs at boot: sshd, then Docker. */
const BOOT = `set -e
apk add --no-cache openssh-server >/dev/null
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
						new Error(
							`${command} ${args.join(' ')} exited ${code}:\n${output.slice(-4000)}`,
						),
					),
		);
	});
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

	await run('docker', [
		'run',
		'-d',
		'--rm',
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
		DIND_IMAGE,
		'/boot.sh',
	]);

	const shell = (script: string) =>
		run('docker', ['exec', name, 'sh', '-c', script]);
	const stop = async () => {
		await run('docker', ['rm', '-f', '-v', name]).catch(() => '');
	};

	try {
		// sshd once its packages are in, and Docker once it answers.
		let ready = false;
		for (let attempt = 0; attempt < 120 && !ready; attempt++) {
			ready = await shell(
				'pgrep -f /usr/sbin/sshd >/dev/null && docker version >/dev/null 2>&1',
			).then(
				() => true,
				() => false,
			);
			if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		if (!ready) throw new Error(`${name} did not start sshd and Docker`);

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
