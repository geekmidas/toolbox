/**
 * `gkm eas:sync --stage <stage>`: a mobile app's EAS project set up for a
 * deployed stage, from what the workspace declares — so a store build, which
 * EAS runs on its own machines, outside gkm, is built with the same values
 * the stage's servers were deployed with.
 *
 * - **`eas.json`**: the stage's build profile (`build.<stage>`) reads its EAS
 *   environment and listens on its channel; its submit profile
 *   (`submit.<stage>.android`) has its Play track and release status — see
 *   `mobileStage`. Every other field is left as it is.
 * - **The EAS environment**: each value the app's build reads for the stage
 *   (`StackMobileApp.values`) — its scheme, its edges' public URLs under
 *   `EXPO_PUBLIC_`, and every stage secret already named so — set with
 *   `eas env:set`, as `plaintext`: a bundle inlines them, so none is secret.
 *   Nothing else is written: no server key reaches EAS.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type {
	ConstructManifest,
	MobileAppDeclaration,
} from '@geekmidas/manifest';
import { GkmError } from '../errors';
import { loadStage } from '../exec/stage.js';
import { appKey } from '../workspace/derive.js';
import { type MobileStage, mobileStage } from './stage.js';

const logger = console;

/** The workspace declares no `MobileApp`: nothing to set up. */
export class NoMobileApp extends GkmError {
	constructor() {
		super(
			'The workspace declares no MobileApp, so there is no EAS project to set ' +
				"up. Declare one: new MobileApp('App', { path: 'apps/app' }).dependsOn([api, auth]).",
		);
		this.name = 'NoMobileApp';
	}
}

/** Several `MobileApp`s, and nothing to say which. */
export class MobileAppNotChosen extends GkmError {
	constructor(readonly apps: readonly string[]) {
		super(
			`The workspace declares ${apps.length} mobile apps (${apps.join(', ')}). ` +
				`Run from one's directory, or name it: --app ${apps[0]}.`,
		);
		this.name = 'MobileAppNotChosen';
	}
}

/** `--app` names no `MobileApp`. */
export class MobileAppUnknown extends GkmError {
	constructor(
		readonly app: string,
		readonly apps: readonly string[],
	) {
		super(
			`'${app}' is not one of the workspace's mobile apps (${apps.join(', ')}).`,
		);
		this.name = 'MobileAppUnknown';
	}
}

/** `eas` is not installed where the app is. */
export class EasCliMissing extends GkmError {
	constructor(readonly dir: string) {
		super(
			`No \`eas\` to run in ${dir}. Add it to the app: pnpm add -D eas-cli ` +
				'(or install it globally: npm install -g eas-cli).',
		);
		this.name = 'EasCliMissing';
	}
}

/** `eas` refused a command. */
export class EasCommandFailed extends GkmError {
	constructor(
		readonly command: string,
		readonly code: number | null,
		readonly stderr: string,
	) {
		super(
			`\`eas ${command}\` failed (exit ${code}): ${stderr.trim() || 'it said nothing'}. ` +
				'In CI, EXPO_TOKEN must be set; on this machine, `eas login`.',
		);
		this.name = 'EasCommandFailed';
	}
}

/** A platform EAS builds for. */
export type EasPlatform = 'ios' | 'android';

/** What gkm asks of EAS, so tests can stand in. */
export interface EasCli {
	/** Create or update a variable in one of the project's environments. */
	setEnv(
		dir: string,
		variable: { environment: string; name: string; value: string },
	): Promise<void>;
	/**
	 * The fingerprint of the app's native code, as a build with `profile`
	 * would compute it — what its runtime version is.
	 */
	fingerprint(
		dir: string,
		options: { platform: EasPlatform; profile: string },
	): Promise<string>;
	/** A finished store build of `profile` with that fingerprint, if any. */
	storeBuild(
		dir: string,
		options: { platform: EasPlatform; profile: string; fingerprint: string },
	): Promise<string | undefined>;
	/** Start a store build of `profile`, submitted to the store when asked. */
	build(
		dir: string,
		options: {
			platform: EasPlatform;
			profile: string;
			submit: boolean;
			wait: boolean;
		},
	): Promise<void>;
	/** Publish an update of the app's JavaScript on a channel. */
	update(
		dir: string,
		options: {
			platform: EasPlatform;
			channel: string;
			environment: string;
			message: string;
		},
	): Promise<void>;
}

/**
 * Run `eas` in `dir`: the app's own, else the workspace's, else the one on
 * PATH. What it prints on stdout is answered; a failure is
 * {@link EasCommandFailed} with what it said.
 */
function runEas(
	root: string,
	dir: string,
	args: readonly string[],
	options: { inherit?: boolean; env?: Readonly<Record<string, string>> } = {},
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('eas', [...args, '--non-interactive'], {
			cwd: dir,
			// A build's or an update's progress is the user's to read.
			stdio: ['ignore', options.inherit ? 'inherit' : 'pipe', 'pipe'],
			env: {
				...process.env,
				...options.env,
				PATH: [
					join(dir, 'node_modules', '.bin'),
					join(root, 'node_modules', '.bin'),
					process.env.PATH,
				].join(delimiter),
			},
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
			if (options.inherit) process.stderr.write(chunk);
		});
		const command = args.slice(0, 3).join(' ');
		child.on('error', (error: NodeJS.ErrnoException) =>
			reject(
				error.code === 'ENOENT'
					? new EasCliMissing(dir)
					: new EasCommandFailed(command, null, error.message),
			),
		);
		child.on('close', (code) =>
			code === 0
				? resolve(stdout)
				: reject(new EasCommandFailed(command, code, stderr)),
		);
	});
}

/** The JSON `eas … --json` printed, read for `what`. */
function easJson(output: string, what: string): unknown {
	try {
		return JSON.parse(output);
	} catch {
		throw new EasCommandFailed(what, 0, `not JSON: ${output.slice(0, 200)}`);
	}
}

/**
 * The real one — never a prompt (`--non-interactive`). `env` is what the
 * app's `app.config.ts` reads for the stage: every `eas` command evaluates
 * it, and one that reads a value it lacks fails before it starts — and a
 * fingerprint computed here must match the one EAS computes with the
 * stage's values.
 */
export function easCli(
	root: string,
	env: Readonly<Record<string, string>> = {},
): EasCli {
	const run = (
		dir: string,
		args: readonly string[],
		options: { inherit?: boolean } = {},
	) => runEas(root, dir, args, { ...options, env });
	return {
		async setEnv(dir, { environment, name, value }) {
			await run(dir, [
				'env:set',
				'--environment',
				environment,
				'--name',
				name,
				'--value',
				value,
				'--visibility',
				'plaintext',
				'--scope',
				'project',
			]);
		},

		async fingerprint(dir, { platform, profile }) {
			const output = await run(dir, [
				'fingerprint:generate',
				'--platform',
				platform,
				'--build-profile',
				profile,
				'--json',
			]);
			const hash = (
				easJson(output, 'fingerprint:generate') as { hash?: unknown }
			).hash;
			if (typeof hash !== 'string') {
				throw new EasCommandFailed('fingerprint:generate', 0, 'no hash');
			}
			return hash;
		},

		async storeBuild(dir, { platform, profile, fingerprint }) {
			const output = await run(dir, [
				'build:list',
				'--platform',
				platform,
				'--build-profile',
				profile,
				'--fingerprint-hash',
				fingerprint,
				'--status',
				'finished',
				'--distribution',
				'store',
				'--limit',
				'1',
				'--json',
			]);
			const builds = easJson(output, 'build:list');
			if (!Array.isArray(builds)) return undefined;
			const id = (builds[0] as { id?: unknown } | undefined)?.id;
			return typeof id === 'string' ? id : undefined;
		},

		async build(dir, { platform, profile, submit, wait }) {
			await run(
				dir,
				[
					'build',
					'--platform',
					platform,
					'--profile',
					profile,
					...(submit ? ['--auto-submit'] : []),
					...(wait ? [] : ['--no-wait']),
				],
				{ inherit: true },
			);
		},

		async update(dir, { platform, channel, environment, message }) {
			await run(
				dir,
				[
					'update',
					'--platform',
					platform,
					'--channel',
					channel,
					'--environment',
					environment,
					'--message',
					message,
				],
				{ inherit: true },
			);
		},
	};
}

/**
 * The mobile app a command is about: the one `--app` names, else the one
 * this directory is, else the only one.
 *
 * @throws {NoMobileApp}, {MobileAppNotChosen}, {MobileAppUnknown}
 */
export function chooseMobileApp(
	manifest: ConstructManifest,
	app: string | undefined,
	here: string | undefined,
): MobileAppDeclaration {
	const declarations = Object.values(manifest).filter(
		(declaration): declaration is MobileAppDeclaration =>
			declaration.kind === 'mobile-app',
	);
	const names = declarations.map((declaration) => appKey(declaration.id));
	if (declarations.length === 0) throw new NoMobileApp();
	const name =
		app ??
		(here && names.includes(here)
			? here
			: names.length === 1
				? names[0]
				: undefined);
	if (!name) throw new MobileAppNotChosen(names);
	const declaration = declarations.find((d) => appKey(d.id) === name);
	if (!declaration) throw new MobileAppUnknown(name, names);
	return declaration;
}

/** `eas.json`, as far as gkm writes it. */
interface EasJson {
	build?: Record<string, Record<string, unknown>>;
	submit?: Record<string, Record<string, unknown>>;
	[key: string]: unknown;
}

/**
 * `eas.json` with the stage's build and submit profiles as `stage` says:
 * every field gkm does not decide is kept.
 */
export function withStageProfiles(
	easJson: EasJson,
	stage: MobileStage,
): EasJson {
	const build = easJson.build?.[stage.stage] ?? {};
	const submit = easJson.submit?.[stage.stage] ?? {};
	const android = (submit.android as Record<string, unknown> | undefined) ?? {};
	return {
		...easJson,
		build: {
			...easJson.build,
			[stage.stage]: {
				...build,
				environment: stage.environment,
				channel: stage.channel,
			},
		},
		submit: {
			...easJson.submit,
			[stage.stage]: {
				...submit,
				android: {
					...android,
					track: stage.android.track,
					releaseStatus: stage.android.releaseStatus,
				},
			},
		},
	};
}

export interface EasSyncOptions {
	stage: string;
	/** The mobile app, by its app key; the one here, or the only one, if not. */
	app?: string;
	/** The AWS profile for the stage's account, where its secrets are kept. */
	profile?: string;
	cwd?: string;
	/** Say what would be written, and write nothing. */
	dryRun?: boolean;
}

/** What a sync wrote — or, dry, would. */
export interface EasSyncResult {
	app: string;
	/** The workspace's root, where its `eas` may be installed. */
	root: string;
	dir: string;
	stage: MobileStage;
	values: Record<string, string>;
	/** Whether `eas.json` changed. */
	easJsonChanged: boolean;
}

/**
 * Set up a mobile app's EAS project for a deployed stage.
 *
 * @throws {NoMobileApp}, {MobileAppNotChosen}, {MobileAppUnknown},
 *   {MobileAppStageUndeclared}, {EasCliMissing}, {EasCommandFailed} — and
 *   what loading the stage throws: {UndeclaredStage}, {ExecStageNotComposed},
 *   {ExecStageNotDeployed}
 */
export async function easSync(
	options: EasSyncOptions,
	eas?: EasCli,
): Promise<EasSyncResult> {
	const loaded = await loadStage(options);
	const { workspace, manifest, stack } = loaded;

	const declaration = chooseMobileApp(manifest, options.app, loaded.appName);
	const name = appKey(declaration.id);

	const stage = mobileStage(workspace, declaration, options.stage);
	const values =
		stack.mobileApps.find((candidate) => candidate.name === name)?.values ?? {};
	const dir = join(workspace.root, declaration.app.path);

	const path = join(dir, 'eas.json');
	const before = existsSync(path)
		? (JSON.parse(await readFile(path, 'utf8')) as EasJson)
		: {};
	const after = withStageProfiles(before, stage);
	const easJsonChanged = JSON.stringify(before) !== JSON.stringify(after);

	const where = `${name} on '${stage.stage}': EAS environment '${stage.environment}', channel '${stage.channel}', Play track '${stage.android.track}' (${stage.android.releaseStatus})`;
	if (options.dryRun) {
		logger.log(`📱 ${where} (dry run)`);
		if (easJsonChanged) {
			logger.log(
				`   would write build.${stage.stage} and submit.${stage.stage} in ${path}`,
			);
		}
		for (const [key, value] of Object.entries(values)) {
			logger.log(`   would set ${key}=${value}`);
		}
		return {
			app: name,
			root: workspace.root,
			dir,
			stage,
			values,
			easJsonChanged,
		};
	}

	logger.log(`📱 ${where}`);
	if (easJsonChanged) {
		await writeFile(path, `${JSON.stringify(after, null, 2)}\n`);
		logger.log(
			`   wrote build.${stage.stage} and submit.${stage.stage} in ${path}`,
		);
	}
	const cli = eas ?? easCli(workspace.root, values);
	for (const [key, value] of Object.entries(values)) {
		await cli.setEnv(dir, { environment: stage.environment, name: key, value });
		logger.log(`   set ${key}`);
	}
	return {
		app: name,
		root: workspace.root,
		dir,
		stage,
		values,
		easJsonChanged,
	};
}
