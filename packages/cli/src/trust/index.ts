/**
 * Installing the local edge's certificate authority into the OS trust store.
 *
 * `NODE_EXTRA_CA_CERTS` covers everything gkm starts — the dev server, the test
 * suite, anything under `gkm exec` — because reconcile injects it. A browser
 * reads none of that: it asks the operating system, so until the root is in the
 * system store a local `https://` address is "not secure", which is true and
 * unhelpful.
 *
 * A separate command rather than part of `gkm setup`, for one reason: this
 * needs `sudo`, and a setup that silently escalates on every run is a worse
 * trade than one that tells you what to type. Caddy's own `caddy trust` draws
 * the line in the same place.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import prompts from 'prompts';
import { loadWorkspaceConfig } from '../config.js';
import { LOCAL_CA_PATH } from '../reconcile/index.js';

const logger = console;

const run = promisify(execFile);

export interface TrustOptions {
	/** Print the commands rather than running them. */
	dryRun?: boolean;
}

/**
 * How each platform is told about a new authority.
 *
 * Separate rather than shelled through one script because the failure modes
 * differ and the message should name the real one: macOS refuses without an
 * admin password, Debian needs the file in a specific directory before its
 * updater will look at it.
 */
function installation(
	platform: NodeJS.Platform,
	certificate: string,
): { describe: string; steps: [string, string[]][] } {
	if (platform === 'darwin') {
		return {
			describe: 'the System keychain',
			steps: [
				[
					'sudo',
					[
						'security',
						'add-trusted-cert',
						'-d',
						'-r',
						'trustRoot',
						'-k',
						'/Library/Keychains/System.keychain',
						certificate,
					],
				],
			],
		};
	}

	if (platform === 'linux') {
		// Debian and Fedora keep anchors in different places and run different
		// updaters. Whichever directory exists is the one this system uses.
		const debian = existsSync('/usr/local/share/ca-certificates');

		return {
			describe: debian ? 'the system CA bundle' : 'the system trust anchors',
			steps: debian
				? [
						[
							'sudo',
							[
								'cp',
								certificate,
								'/usr/local/share/ca-certificates/gkm-local-ca.crt',
							],
						],
						['sudo', ['update-ca-certificates']],
					]
				: [
						[
							'sudo',
							[
								'cp',
								certificate,
								'/etc/pki/ca-trust/source/anchors/gkm-local-ca.crt',
							],
						],
						['sudo', ['update-ca-trust']],
					],
		};
	}

	throw new UnsupportedPlatform(platform, certificate);
}

/**
 * Trust the certificate authority this project's edge issues from.
 *
 * Idempotent in effect: installing a root that is already trusted replaces the
 * same entry, so running it twice is not an error.
 */
export async function trustCommand(options: TrustOptions = {}): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();
	const certificate = join(workspace.root, LOCAL_CA_PATH);

	if (!existsSync(certificate)) {
		throw new NoLocalAuthority(certificate);
	}

	const { describe, steps } = installation(process.platform, certificate);

	logger.log(`\n🔐 Trusting the local authority in ${describe}`);
	logger.log(`   ${certificate}\n`);

	if (options.dryRun) {
		for (const [command, args] of steps) {
			logger.log(`   ${command} ${args.join(' ')}`);
		}
		return;
	}

	logger.log('   This needs an admin password.\n');

	for (const [command, args] of steps) {
		// Inherited stdio, because sudo prompts on the terminal and a captured
		// prompt is a command that appears to hang.
		await run(command, args, { stdio: 'inherit' } as never);
	}

	logger.log('\n✅ Local https addresses are trusted. Restart your browser.\n');
}

/**
 * Trust the authority if this project wants that and this machine lacks it.
 *
 * The decision, in order: what the project configured, then what a person
 * previously answered, then a prompt. Never a silent `sudo` — that is the one
 * thing a setup command should not do on somebody's behalf.
 *
 * Silent and free when the machine already trusts it, which is what makes it
 * acceptable to call on every `gkm setup`.
 */
export async function ensureTrusted(
	root: string,
	url: string,
	options: { configured?: boolean; assumeYes?: boolean } = {},
): Promise<void> {
	if (options.configured === false) return;
	if (await isTrusted(url)) return;

	if (options.configured !== true && !options.assumeYes) {
		// Nothing to answer a prompt in CI, a hook, or a piped shell — and a
		// setup that stops there waiting is worse than one that leaves the
		// authority untrusted. Not recorded as declined, because nobody
		// declined: the next interactive run should still ask.
		if (!process.stdin.isTTY) {
			logger.log(
				'   Local https addresses are not trusted here. Run "gkm trust", ' +
					'or set services.trustLocalCa.',
			);
			return;
		}

		// A recorded "no" is why this asks once rather than every start. There is
		// no recorded "yes": trusting is checked directly above, so a yes that
		// worked answers itself and a yes that did not should ask again.
		if (await declined(root)) return;

		const { install } = await prompts({
			type: 'confirm',
			name: 'install',
			message:
				"Trust this project's local certificate authority, so a browser " +
				'accepts its https addresses? (needs sudo)',
			initial: false,
		});

		if (!install) {
			await recordDeclined(root);
			logger.log(
				'   Skipped. Run "gkm trust" later, or set services.trustLocalCa.',
			);
			return;
		}
	}

	await trustCommand();
}

/** Where a declined answer is remembered, so setup asks once and not again. */
const TRUST_STATE = '.gkm/trust.json';

async function declined(root: string): Promise<boolean> {
	try {
		const raw = await readFile(join(root, TRUST_STATE), 'utf-8');

		return (JSON.parse(raw) as { declined?: boolean }).declined === true;
	} catch {
		return false;
	}
}

async function recordDeclined(root: string): Promise<void> {
	const path = join(root, TRUST_STATE);

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ declined: true }, null, 2)}\n`);
}

/**
 * Whether this machine already trusts the local authority.
 *
 * Asked by connecting rather than by reading a keychain: what matters is
 * whether a client with no special configuration verifies the edge, and that is
 * one platform-neutral question instead of three platform-specific ones. It is
 * also the exact thing a browser is about to do.
 *
 * A child process, because `NODE_EXTRA_CA_CERTS` is read once at startup and
 * this process almost certainly has it set — asking in-process would answer
 * "yes" for everyone.
 */
export async function isTrusted(url: string): Promise<boolean> {
	const { NODE_EXTRA_CA_CERTS: _ignored, ...env } = process.env;

	try {
		await run(
			process.execPath,
			['-e', `fetch(${JSON.stringify(url)}).then(()=>0,()=>process.exit(1))`],
			{ env, timeout: 15_000 },
		);

		return true;
	} catch {
		return false;
	}
}

/**
 * Copy the root somewhere a tool that wants a file can read it.
 *
 * For anything that takes a CA bundle rather than reading the system store —
 * another language's HTTP client, a container, a CI job.
 */
export async function exportLocalAuthority(to: string): Promise<void> {
	const { workspace } = await loadWorkspaceConfig();
	const certificate = join(workspace.root, LOCAL_CA_PATH);

	if (!existsSync(certificate)) throw new NoLocalAuthority(certificate);

	await copyFile(certificate, to);
}

/** The edge has not run, so there is no authority to trust yet. */
export class NoLocalAuthority extends Error {
	constructor(readonly path: string) {
		super(
			`No local certificate authority at ${path}. It is generated the first ` +
				`time the edge starts, so run "gkm setup" (or "gkm dev") once — and ` +
				`if this project declares no file server, nothing needs one.`,
		);
		this.name = 'NoLocalAuthority';
	}
}

/** A platform with no trust store this knows how to write to. */
export class UnsupportedPlatform extends Error {
	constructor(
		readonly platform: string,
		readonly certificate: string,
	) {
		super(
			`gkm does not know how to install a certificate authority on ` +
				`${platform}. The root is at ${certificate} — add it to the trust ` +
				`store by hand, or point a client at it with NODE_EXTRA_CA_CERTS.`,
		);
		this.name = 'UnsupportedPlatform';
	}
}
