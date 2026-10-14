/**
 * `gkm compose:server` — make a VPS ready for a stage's compose deploys, from
 * this machine, in one go.
 *
 * It logs in as the server's admin — a sudo user, never root — and, through
 * sudo, sets the server up the way a production VPS should be: SSH by key
 * only with root's login off, a firewall open on SSH, 80 and 443 alone,
 * security updates installed daily, fail2ban on sshd, and Docker from
 * Docker's own repository. It then creates the stage's deploy user (in the
 * docker group, no sudo, no password) and authorizes a deploy key on it that
 * may run commands and open the tunnel migrations use, nothing more.
 *
 * Off the server: it makes the deploy key pair here, pins the server's host
 * key — checked against the fingerprint the server reports of itself — and
 * gives both to the stage's GitHub environment as `DEPLOY_SSH_KEY` and
 * `DEPLOY_KNOWN_HOSTS`, which the generated deploy workflow reads. Last, it
 * logs in exactly as CI will, and checks Docker and the tunnel answer.
 *
 * A fresh server only root can log in to gets its admin first: as root —
 * with root's key, or its password on a brand-new server — it creates the
 * user, and `ssh-copy-id` puts your key on it when root had none to give.
 * Root's password is locked once the admin's sudo works.
 *
 * Once it has, the stage's state records that it is done (`server:compose`,
 * stamped with who and when) — nothing personal: the admin is whoever runs
 * it, with their own key.
 * Safe to run again: each step changes only what is missing or wrong.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadWorkspaceConfig } from '../config';
import { describeActor } from '../deploy/actor';
import { type Gh, ghCli } from '../deploy/github';
import { DeployJournal } from '../deploy/journal';
import { createStateStore, type StateStore } from '../deploy/StateStore';
import { createComposeState } from '../deploy/state';
import { GkmError } from '../errors';
import { prompt } from '../prompt';
import { secretsStoreFor } from '../secrets/store.js';
import { assertDeployedStage } from '../workspace/stages.js';
import { type ComposeServer, composeServer } from './server';
import { ADMIN_SCRIPT, SERVER_SCRIPT } from './serverScript';

export interface ComposeServerSetupOptions {
	/** The deployed stage whose server this is. */
	stage: string;
	/**
	 * The server's sudo user. Absent, the user `ssh` logs in to the server as
	 * by default (`~/.ssh/config`, else this machine's) — asked for only when
	 * that is root.
	 */
	admin?: string;
	/** The key the admin logs in with. Absent, `ssh`'s own choice. */
	identity?: string;
	/** The deploy key pair. Default `~/.ssh/gkm-<project>-<stage>`. */
	keyFile?: string;
	/** `owner/name`; defaults to the repository `gh` sees here. */
	repo?: string;
	/** `--no-github`: leave the GitHub environment alone. */
	github?: boolean;
	/** Print the plan and the script; connect to nothing. */
	dryRun?: boolean;
	/** Apply without asking first. */
	yes?: boolean;
	cwd?: string;
}

/** What a finished command ran: output kept, its exit code. */
export interface Ran {
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * Runs a program. `interactive` gives it this terminal's stdin and stderr —
 * for a password sudo or adduser asks — while stdout is still kept, and
 * echoed as it comes.
 */
export type Runner = (
	command: string,
	args: readonly string[],
	options?: { input?: string; interactive?: boolean },
) => Promise<Ran>;

export interface ComposeServerSetupDeps {
	run: Runner;
	gh: Gh;
	/** Ask the person at the terminal. */
	ask: (question: string) => Promise<string>;
	/** The stage's state; the workspace's own store when absent. */
	state: StateStore;
}

/** The stage's record of its server, as `compose:server` last set it up. */
export const SERVER_RECORD = 'server:compose';

/**
 * What `server:compose` holds: which server was set up. Who set it up, and
 * when, are the record's own `updatedBy` and `updatedAt`.
 */
export interface ServerRecordData {
	host: string;
}

export interface ComposeServerSetupResult {
	server: ComposeServer;
	admin: string;
	keyFile: string;
	/** The pinned host key line, as `known_hosts` holds it. Absent on a dry run. */
	knownHosts?: string;
	/** The repository whose environment was given the key. */
	repo?: string;
}

/** The admin named is root, whose login this command turns off. */
export class ComposeServerAdminIsRoot extends GkmError {
	constructor() {
		super(
			"The admin can't be root: setting up the server turns root's SSH login " +
				'off. Name the sudo user you log in as (--admin <user>). A fresh ' +
				'server with only root gets one: run this again with the name it ' +
				"should have, and gkm offers to create it with root's key.",
		);
		this.name = 'ComposeServerAdminIsRoot';
	}
}

/** The admin named is the deploy user, which has no sudo. */
export class ComposeServerAdminIsDeployUser extends GkmError {
	constructor(readonly user: string) {
		super(
			`'${user}' is the stage's deploy user (deploy.compose.server), which ` +
				'gkm creates without sudo. Name the sudo user you log in as with --admin.',
		);
		this.name = 'ComposeServerAdminIsDeployUser';
	}
}

/** No key logs the admin in, and nothing was done to make one. */
export class ComposeServerAdminUnreachable extends GkmError {
	constructor(
		readonly target: string,
		readonly stderr: string,
	) {
		super(
			`Could not log in as ${target} with a key (ssh said: ${stderr.trim() || 'nothing'}). ` +
				`Check \`ssh ${target}\` works without a password — copy your key with ` +
				`\`ssh-copy-id ${target}\` — then run this again.`,
		);
		this.name = 'ComposeServerAdminUnreachable';
	}
}

/**
 * The server was set up already, and this person cannot log in to it as
 * the admin they named. Root's login and passwords are off there, so only
 * an admin can let them in.
 */
export class ComposeServerAccessNeeded extends GkmError {
	constructor(
		readonly target: string,
		readonly setUpBy: string,
		readonly setUpOn: string,
	) {
		super(
			`${target} can't log in with your key, and the server was set up by ${setUpBy} on ${setUpOn} — ` +
				'root and password logins are off there. Ask them, or another admin, to add your ' +
				`public key to ${target.split('@')[0]}'s ~/.ssh/authorized_keys (or create you a sudo ` +
				'user with it), then run this again.',
		);
		this.name = 'ComposeServerAccessNeeded';
	}
}

/** `ssh-keygen` could not make the deploy key pair. */
export class DeployKeyNotMade extends GkmError {
	constructor(
		readonly keyFile: string,
		readonly stderr: string,
	) {
		super(
			`Could not make the deploy key ${keyFile} (ssh-keygen said: ${stderr.trim() || 'nothing'}). ` +
				'Pass another path with --key-file.',
		);
		this.name = 'DeployKeyNotMade';
	}
}

/** The script on the server stopped before it finished. */
export class ComposeServerSetupFailed extends GkmError {
	constructor(
		readonly target: string,
		readonly code: number,
	) {
		super(
			`Setting up ${target} stopped (exit ${code}); its output is above. ` +
				'Fix what it names and run this again — every step it already ' +
				'finished is left as it is.',
		);
		this.name = 'ComposeServerSetupFailed';
	}
}

/** The host key the network shows is not the one the server holds. */
export class ComposeServerHostKeyMismatch extends GkmError {
	constructor(
		readonly host: string,
		readonly server: string,
		readonly scanned: string,
	) {
		super(
			`${host}'s host key is ${server} on the server, but ${scanned || 'nothing'} ` +
				'over the network. Something between here and the server answered for ' +
				'it, or the server is not the one you logged in to. Nothing was given ' +
				'to GitHub; find out why before running this again.',
		);
		this.name = 'ComposeServerHostKeyMismatch';
	}
}

/** The deploy key logged in, but cannot do what a deploy does. */
export class ComposeServerCheckFailed extends GkmError {
	constructor(
		readonly target: string,
		readonly check: 'docker' | 'tunnel',
		readonly output: string,
	) {
		super(
			check === 'docker'
				? `The deploy key can't run docker as ${target} (ssh said: ${output.trim() || 'nothing'}).`
				: `The deploy key can't open a tunnel as ${target} (got: ${output.trim() || 'nothing'}). ` +
						"Check its line in the deploy user's authorized_keys says " +
						'restrict,port-forwarding, and that sshd allows it forwarding.',
		);
		this.name = 'ComposeServerCheckFailed';
	}
}

/** `'…'`, for a value in a command line the remote shell reads. */
function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The remote command that runs `script` with `args`: written to a temporary
 * file (so the script keeps the terminal for any password it asks), run,
 * and removed. `sudo` for everything but root.
 */
export function remoteCommand(
	script: string,
	args: readonly string[],
	sudo: boolean,
): string {
	const encoded = Buffer.from(script).toString('base64');
	return [
		`f="$(mktemp)"`,
		`echo ${encoded} | base64 -d > "$f"`,
		`${sudo ? 'sudo ' : ''}bash "$f" ${args.map(shellQuote).join(' ')}; s=$?`,
		`rm -f "$f"`,
		'exit $s',
	].join('; ');
}

function sshOptions(server: ComposeServer): string[] {
	return ['-o', 'ConnectTimeout=20', '-p', String(server.port)];
}

/** How the admin (or root) logs in: the server's options and their key. */
function loginOptions(server: ComposeServer, identity?: string): string[] {
	return [
		...sshOptions(server),
		...(identity ? ['-i', identity, '-o', 'IdentitiesOnly=yes'] : []),
	];
}

/** `user@host`, as `ssh` takes it. */
function at(user: string, host: string): string {
	return `${user}@${host}`;
}

/** The real runner: the system's programs. */
export const systemRunner: Runner = (command, args, options = {}) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: [
				options.interactive ? 'inherit' : 'pipe',
				'pipe',
				options.interactive ? 'inherit' : 'pipe',
			],
			timeout: options.interactive ? undefined : 60_000,
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
			if (options.interactive) process.stdout.write(chunk);
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
		if (child.stdin) child.stdin.end(options.input ?? '');
	});

/** Whether `answer` is a yes, `fallback` when nothing was typed. */
function isYes(answer: string, fallback: boolean): boolean {
	const value = answer.trim().toLowerCase();
	return value === '' ? fallback : value === 'y' || value === 'yes';
}

/** The SHA256 fingerprint of each key in `keys`, by `ssh-keygen -lf -`. */
async function fingerprints(run: Runner, keys: string): Promise<string[]> {
	const { stdout } = await run('ssh-keygen', ['-lf', '-'], { input: keys });
	return stdout
		.split('\n')
		.map((line) => line.split(' ')[1])
		.filter((value): value is string => Boolean(value));
}

/** The default deploy key pair for a stage. */
export function defaultKeyFile(project: string, stage: string): string {
	return join(homedir(), '.ssh', `gkm-${project}-${stage}`);
}

/** `gkm compose:server`. */
export async function composeServerCommand(
	options: ComposeServerSetupOptions,
	deps: Partial<ComposeServerSetupDeps> = {},
): Promise<ComposeServerSetupResult> {
	const run = deps.run ?? systemRunner;
	const gh = deps.gh ?? ghCli;
	const ask =
		deps.ask ??
		((question: string) =>
			prompt(question, {
				instead: 'Name the server user with --admin and pass --yes.',
			}));
	const github = options.github !== false;
	const { stage } = options;

	const cwd = resolve(options.cwd ?? process.cwd());
	const { workspace } = await loadWorkspaceConfig(cwd);
	assertDeployedStage(workspace.stages, stage);
	const server = composeServer({
		stage,
		local: false,
		config: workspace.deploy?.compose?.server,
		custom: (await (await secretsStoreFor(workspace, stage)).read(stage))
			?.custom,
	})!;

	// Whether this server was set up before, by whom and when.
	const state =
		deps.state ??
		(await createStateStore({
			config: workspace.state,
			workspaceRoot: workspace.root,
			workspaceName: workspace.name,
			namespace: workspace.deploy?.namespace,
		}));
	const record = (await state.read(stage))?.resources[SERVER_RECORD];
	const done =
		(record?.data as ServerRecordData | undefined)?.host === server.host
			? record
			: undefined;

	// The admin's login: `--admin`/`--identity`, or what `ssh` itself would
	// use for this host — read with `ssh -G`, which connects to nothing.
	const identity = options.identity ? resolve(options.identity) : undefined;
	const asAdmin = loginOptions(server, identity);
	const sshUser =
		(await run('ssh', ['-G', ...asAdmin, server.host])).stdout.match(
			/^user (\S+)$/m,
		)?.[1] ?? '';
	const admin = (
		options.admin ??
		(sshUser && sshUser !== 'root'
			? sshUser
			: await ask(`The sudo user you log in to ${server.host} as (not root): `))
	).trim();
	if (!admin || admin === 'root') throw new ComposeServerAdminIsRoot();
	if (admin === server.user) throw new ComposeServerAdminIsDeployUser(admin);

	const keyFile = resolve(
		options.keyFile ?? defaultKeyFile(workspace.name, stage),
	);
	const comment = `gkm-${workspace.name}-${stage}-deploy`;
	const repo = github
		? (options.repo ??
			gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']))
		: undefined;
	const adminTarget = at(admin, server.host);
	const deployTarget = at(server.user, server.host);

	console.log(`\n🖥  Server for stage "${stage}"\n`);
	console.log(`  Server:      ${server.host} (ssh port ${server.port})`);
	console.log(
		`  Admin:       ${admin} — logs in with ${identity ?? 'your SSH key'}, runs sudo${options.admin ? '' : ' (your SSH login)'}`,
	);
	console.log(
		`  Deploy user: ${server.user} — docker group, no sudo, no password`,
	);
	console.log(
		`  Deploy key:  ${keyFile}${existsSync(keyFile) ? '' : ' (new, made here)'}`,
	);
	console.log(
		`  GitHub:      ${repo ? `environment "${stage}" of ${repo}: DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS` : 'left alone (--no-github)'}`,
	);
	if (done) {
		console.log(
			`\n  Already set up by ${describeActor(done.updatedBy)} on ${done.updatedAt.slice(0, 10)}; running again changes only what is missing or wrong.`,
		);
	}
	console.log('\n  On the server, through sudo:');
	for (const step of [
		"SSH: keys only, root's login off (and nothing else may turn passwords back on)",
		`root's password locked — ${admin}'s sudo is the way to root`,
		`firewall: ${server.port}, 80 and 443 in, everything out`,
		'security updates installed daily (unattended-upgrades); fail2ban on sshd',
		"Docker and its compose plugin, from Docker's repository",
		`user ${server.user}, the deploy key authorized with restrict,port-forwarding`,
	]) {
		console.log(`    · ${step}`);
	}

	if (options.dryRun) {
		console.log(
			`\n  The script, run as: sudo bash setup.sh ${[admin, server.user, String(server.port), '<deploy key>', comment].map(shellQuote).join(' ')}\n`,
		);
		console.log(SERVER_SCRIPT.replace(/^/gm, '    '));
		console.log('  --dry-run: nothing changed.\n');
		return { server, admin, keyFile, ...(repo ? { repo } : {}) };
	}

	if (
		!options.yes &&
		!isYes(await ask(`\n  Set up ${server.host}? [y/N] `), false)
	) {
		console.log('  Nothing changed.\n');
		return { server, admin, keyFile, ...(repo ? { repo } : {}) };
	}

	// ── The deploy key pair, here ──────────────────────────────────────────
	if (!existsSync(keyFile)) {
		await mkdir(dirname(keyFile), { recursive: true, mode: 0o700 });
		const made = await run('ssh-keygen', [
			'-t',
			'ed25519',
			'-N',
			'',
			'-C',
			comment,
			'-f',
			keyFile,
		]);
		if (made.code !== 0) throw new DeployKeyNotMade(keyFile, made.stderr);
		console.log(`\n  ✓ Made the deploy key ${keyFile}`);
	}
	const publicKey = (await readFile(`${keyFile}.pub`, 'utf-8')).trim();

	// ── The admin's login ──────────────────────────────────────────────────
	// Key only, and the host key accepted on first sight — as the first
	// `ssh` to a new server does. CI's is pinned and checked below.
	const probe = (user: string) =>
		run('ssh', [
			'-o',
			'BatchMode=yes',
			'-o',
			'StrictHostKeyChecking=accept-new',
			...asAdmin,
			at(user, server.host),
			'true',
		]);
	let login = await probe(admin);
	// A server already set up has no root or password login left to make
	// one with: an admin there has to let this person in.
	if (login.code !== 0 && done) {
		throw new ComposeServerAccessNeeded(
			adminTarget,
			describeActor(done.updatedBy),
			done.updatedAt.slice(0, 10),
		);
	}
	if (login.code !== 0) {
		// A server only root can log in to yet: root creates the admin — with
		// its key, or on a brand-new server with the password the provider
		// gave it, which this is the last time anything asks for.
		const rootHasKey = (await probe('root')).code === 0;
		const createAsRoot = isYes(
			await ask(
				rootHasKey
					? `\n  ${admin} can't log in with a key, but root can. Create ${admin} as a sudo user with root's keys? [Y/n] `
					: `\n  ${admin} can't log in with a key. Is this a new server, where ${admin} still has to be created? Log in as root with its password to create it [y/N] `,
			),
			rootHasKey,
		);
		if (createAsRoot) {
			const created = await run(
				'ssh',
				[
					'-t',
					...asAdmin,
					at('root', server.host),
					remoteCommand(ADMIN_SCRIPT, [admin], false),
				],
				{ interactive: true },
			);
			if (created.code !== 0) {
				throw new ComposeServerSetupFailed(
					at('root', server.host),
					created.code,
				);
			}
			login = await probe(admin);
		}
		// Root had no key to hand on — a server set up with a password — so
		// yours goes on with the admin's.
		if (
			login.code !== 0 &&
			isYes(
				await ask(
					`\n  ${admin} can't log in with a key. Copy yours there with ssh-copy-id (asks ${admin}'s password)? [Y/n] `,
				),
				true,
			)
		) {
			const copied = await run(
				'ssh-copy-id',
				[
					...(identity ? ['-i', identity] : []),
					'-p',
					String(server.port),
					adminTarget,
				],
				{ interactive: true },
			);
			if (copied.code !== 0) {
				throw new ComposeServerAdminUnreachable(adminTarget, copied.stderr);
			}
		}
		login = await probe(admin);
		if (login.code !== 0) {
			throw new ComposeServerAdminUnreachable(adminTarget, login.stderr);
		}
	}
	console.log(`  ✓ ${adminTarget} logs in with a key\n`);

	// ── The server ─────────────────────────────────────────────────────────
	const setup = await run(
		'ssh',
		[
			'-t',
			...asAdmin,
			adminTarget,
			remoteCommand(
				SERVER_SCRIPT,
				[admin, server.user, String(server.port), publicKey, comment],
				true,
			),
		],
		{ interactive: true },
	);
	if (setup.code !== 0) {
		throw new ComposeServerSetupFailed(adminTarget, setup.code);
	}
	const serverFingerprint = setup.stdout
		.replaceAll('\r', '')
		.match(/^HOSTKEY=(\S+)$/m)?.[1];
	if (!serverFingerprint) {
		throw new ComposeServerSetupFailed(adminTarget, setup.code);
	}

	// ── The host key, pinned ───────────────────────────────────────────────
	const scan = await run('ssh-keyscan', [
		'-t',
		'ed25519',
		'-p',
		String(server.port),
		server.host,
	]);
	const knownHosts = scan.stdout
		.split('\n')
		.filter((line) => line.trim() && !line.startsWith('#'))
		.join('\n');
	const [scanned = ''] = await fingerprints(run, knownHosts);
	if (scanned !== serverFingerprint) {
		throw new ComposeServerHostKeyMismatch(
			server.host,
			serverFingerprint,
			scanned,
		);
	}
	console.log(`\n  ✓ Host key ${scanned}, as the server reports it`);

	if (repo) {
		gh(['api', '--method', 'PUT', `repos/${repo}/environments/${stage}`]);
		gh([
			'variable',
			'set',
			'DEPLOY_KNOWN_HOSTS',
			'--env',
			stage,
			'--repo',
			repo,
			'--body',
			knownHosts,
		]);
		// Through stdin, so the key is never an argument a process list shows.
		gh(
			['secret', 'set', 'DEPLOY_SSH_KEY', '--env', stage, '--repo', repo],
			await readFile(keyFile, 'utf-8'),
		);
		console.log(
			`  ✓ GitHub: environment "${stage}", DEPLOY_SSH_KEY and DEPLOY_KNOWN_HOSTS`,
		);
	}

	// ── Logged in as CI will be ────────────────────────────────────────────
	const known = join(dirname(keyFile), `.gkm-known-${workspace.name}-${stage}`);
	await writeFile(known, `${knownHosts}\n`);
	try {
		const asCi = [
			'-i',
			keyFile,
			'-o',
			'IdentitiesOnly=yes',
			'-o',
			'BatchMode=yes',
			'-o',
			`UserKnownHostsFile=${known}`,
			'-o',
			'StrictHostKeyChecking=yes',
			...sshOptions(server),
		];
		const docker = await run('ssh', [
			...asCi,
			deployTarget,
			'docker',
			'version',
			'--format',
			'{{.Server.Version}}',
		]);
		if (docker.code !== 0) {
			throw new ComposeServerCheckFailed(deployTarget, 'docker', docker.stderr);
		}
		console.log(
			`  ✓ ${deployTarget} runs docker (engine ${docker.stdout.trim()})`,
		);
		// The server's own sshd, through a tunnel: what a migration does to
		// reach Postgres on the server's loopback.
		const tunnel = await run('ssh', [
			...asCi,
			'-W',
			`127.0.0.1:${server.port}`,
			deployTarget,
		]);
		if (!tunnel.stdout.startsWith('SSH-2.0')) {
			throw new ComposeServerCheckFailed(
				deployTarget,
				'tunnel',
				tunnel.stdout.slice(0, 80) || tunnel.stderr,
			);
		}
		console.log(`  ✓ ${deployTarget} opens tunnels (migrations)`);
	} finally {
		await rm(known, { force: true });
	}

	// Done: the stage's state says so, and who did it.
	const journal = await DeployJournal.open(state, stage, () =>
		createComposeState(stage),
	);
	await journal.ready(
		{
			key: SERVER_RECORD,
			type: 'server',
			data: { host: server.host } satisfies ServerRecordData,
		},
		server.host,
	);
	console.log(`  ✓ Recorded in the "${stage}" state`);

	console.log(
		`\n✅ ${server.host} is ready for "${stage}".${repo ? ' CI deploys it with the key it was given.' : ''} ` +
			`To deploy from here, load the key first: ssh-add ${keyFile}\n`,
	);
	return {
		server,
		admin,
		keyFile,
		knownHosts,
		...(repo ? { repo } : {}),
	};
}
