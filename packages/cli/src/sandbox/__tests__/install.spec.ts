/**
 * Installing without lifecycle scripts. The npm cases install for real, from
 * local tarballs, so nothing reaches the registry; the other package managers'
 * flags are checked as argv.
 */

import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	InstallAllowlistNameInvalid,
	InstallScriptsAllowlistUnsupported,
	installCommands,
	installDependencies,
	LocalSandbox,
	type SandboxResult,
} from '../index';

/**
 * A package whose `postinstall` records that it ran, and whether it could
 * see the deploy's AWS key, in its own installed directory.
 */
function pack(vendor: string, name: string): string {
	const dir = join(vendor, name, 'package');
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({
			name,
			version: '1.0.0',
			scripts: { postinstall: 'node record.cjs' },
		}),
	);
	writeFileSync(
		join(dir, 'record.cjs'),
		`require('node:fs').writeFileSync(
			require('node:path').join(__dirname, 'ran.json'),
			JSON.stringify({ sawAwsKey: 'AWS_SECRET_ACCESS_KEY' in process.env }),
		);`,
	);
	const tarball = join(vendor, `${name}-1.0.0.tgz`);
	execFileSync('tar', ['-czf', tarball, '-C', join(vendor, name), 'package']);
	return tarball;
}

/** Every command's output, for a failed assertion to show. */
const shown = (results: SandboxResult[]) =>
	results
		.map((r, i) => `[${i}] exit ${r.exitCode}\n${r.stdout}${r.stderr}`)
		.join('\n');

describe('installDependencies', () => {
	let root: string;
	let home: string;

	const ran = (name: string) => join(root, 'node_modules', name, 'ran.json');

	/** What a package's script recorded, or why there is nothing. */
	const recorded = (name: string, output: string) =>
		existsSync(ran(name))
			? JSON.parse(readFileSync(ran(name), 'utf8'))
			: `${name}'s script never ran:\n${output}`;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-install-')));
		// npm's cache and logs go under HOME: never the real one.
		home = mkdtempSync(join(tmpdir(), 'gkm-install-home-'));
		const vendor = join(root, 'vendor');
		pack(vendor, 'alpha');
		pack(vendor, 'beta');
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({
				name: 'project',
				version: '1.0.0',
				private: true,
				dependencies: {
					alpha: 'file:./vendor/alpha-1.0.0.tgz',
					beta: 'file:./vendor/beta-1.0.0.tgz',
				},
				scripts: {
					postinstall: "node -e \"require('fs').writeFileSync('own-ran','')\"",
				},
			}),
		);
		writeFileSync(
			join(root, '.npmrc'),
			'audit=false\nfund=false\nupdate-notifier=false\nprefer-offline=true\n',
		);
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'aws-secret');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it('runs only the allowed packages’ scripts, and none of the project’s', async () => {
		const output = shown(
			await installDependencies(new LocalSandbox({ root, home }), {
				packageManager: 'npm',
				ignoreScripts: true,
				allowScripts: ['alpha'],
				output: 'capture',
			}),
		);

		expect(
			existsSync(join(root, 'node_modules', 'beta', 'package.json')),
			output,
		).toBe(true);
		expect(existsSync(ran('beta')), output).toBe(false);
		expect(existsSync(join(root, 'own-ran')), output).toBe(false);
		// The one that was allowed ran — in the sandbox, without the key.
		expect(recorded('alpha', output), output).toEqual({
			sawAwsKey: false,
		});
	}, 120_000);

	it('does the same with pnpm, which builds nothing it was not told to', async () => {
		// pnpm's store goes under the scratch home too.
		writeFileSync(
			join(root, '.npmrc'),
			`store-dir=${join(home, 'pnpm-store')}\n`,
		);
		execFileSync('pnpm', ['install', '--lockfile-only'], {
			cwd: root,
			env: { ...process.env, HOME: home },
			stdio: 'ignore',
		});

		const output = shown(
			await installDependencies(new LocalSandbox({ root, home }), {
				ignoreScripts: true,
				allowScripts: ['alpha'],
				output: 'capture',
			}),
		);

		expect(
			existsSync(join(root, 'node_modules', 'beta', 'package.json')),
			output,
		).toBe(true);
		expect(existsSync(ran('beta')), output).toBe(false);
		expect(existsSync(join(root, 'own-ran')), output).toBe(false);
		expect(recorded('alpha', output), output).toEqual({
			sawAwsKey: false,
		});
	}, 120_000);

	it('leaves scripts to the package manager by default, as a plain install does', async () => {
		const sandbox = new LocalSandbox({ root, home });
		// npm 12 blocks every dependency's install script its `allowScripts`
		// policy has not approved; earlier npm runs them all. A plain install
		// does whichever the installed npm does, and so does this one.
		const { stdout } = await sandbox.exec('npm', ['--version'], {
			cwd: '.',
			env: { ...sandbox.env },
			timeoutMs: 30_000,
		});
		const dependencyScriptsRun = Number(stdout.split('.')[0]) < 12;

		const output = shown(
			await installDependencies(sandbox, {
				packageManager: 'npm',
				output: 'capture',
			}),
		);

		expect(existsSync(join(root, 'own-ran')), output).toBe(true);
		expect(existsSync(ran('alpha')), output).toBe(dependencyScriptsRun);
		expect(existsSync(ran('beta')), output).toBe(dependencyScriptsRun);
	}, 120_000);
});

describe('installCommands', () => {
	const options = {
		ignoreScripts: true,
		allowScripts: ['esbuild', '@prisma/client'],
	};

	it('rebuilds the allowed packages past npm 12’s script policy', () => {
		expect(installCommands('npm', '/p', options)).toEqual([
			['npm', ['install', '--ignore-scripts']],
			[
				'npm',
				[
					'rebuild',
					'--dangerously-allow-all-scripts',
					'esbuild',
					'@prisma/client',
				],
			],
		]);
	});

	it('skips scripts and rebuilds the allowed packages with pnpm', () => {
		expect(installCommands('pnpm', '/p', options)).toEqual([
			['pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']],
			[
				'pnpm',
				[
					'rebuild',
					'--config.dangerouslyAllowAllBuilds=true',
					'esbuild',
					'@prisma/client',
				],
			],
		]);
	});

	it('changes nothing about an install that keeps its scripts', () => {
		expect(installCommands('pnpm', '/p')).toEqual([
			['pnpm', ['install', '--frozen-lockfile']],
		]);
		// The allowlist means nothing when nothing is skipped.
		expect(
			installCommands('pnpm', '/p', { allowScripts: ['esbuild'] }),
		).toEqual([['pnpm', ['install', '--frozen-lockfile']]]);
	});

	it('skips builds by mode with Yarn 2+', () => {
		const berry = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-yarn-')));
		writeFileSync(join(berry, '.yarnrc.yml'), '');
		try {
			expect(installCommands('yarn', berry, options)).toEqual([
				['yarn', ['install', '--immutable', '--mode=skip-build']],
				['yarn', ['rebuild', 'esbuild', '@prisma/client']],
			]);
		} finally {
			rmSync(berry, { recursive: true, force: true });
		}
	});

	it.each([
		['yarn', 'Yarn 1'],
		['bun', 'bun'],
	] as const)('refuses an allowlist %s cannot honour, before installing', (pm, named) => {
		expect(() => installCommands(pm, '/p', options)).toThrow(
			InstallScriptsAllowlistUnsupported,
		);
		expect(() => installCommands(pm, '/p', options)).toThrow(named);
		expect(installCommands(pm, '/p', { ignoreScripts: true })).toEqual([
			[pm, ['install', '--frozen-lockfile', '--ignore-scripts']],
		]);
	});

	it.each([
		'--unsafe-perm',
		'../x',
		'Esbuild',
		'',
	])('refuses %j as a package to allow', (name) => {
		expect(() =>
			installCommands('npm', '/p', {
				ignoreScripts: true,
				allowScripts: [name],
			}),
		).toThrow(InstallAllowlistNameInvalid);
	});
});
