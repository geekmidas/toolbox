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
import type { MobileAppDeclaration } from '@geekmidas/manifest';
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

/** What gkm asks of EAS, so tests can stand in. */
export interface EasCli {
	/** Create or update a variable in one of the project's environments. */
	setEnv(
		dir: string,
		variable: { environment: string; name: string; value: string },
	): Promise<void>;
}

/**
 * The real one: the `eas` the app installs, else the workspace's, else the
 * one on PATH — never a prompt (`--non-interactive`).
 */
export function easCli(root: string): EasCli {
	return {
		setEnv(dir, { environment, name, value }) {
			const args = [
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
				'--non-interactive',
			];
			return new Promise((resolve, reject) => {
				const child = spawn('eas', args, {
					cwd: dir,
					stdio: ['ignore', 'ignore', 'pipe'],
					env: {
						...process.env,
						PATH: [
							join(dir, 'node_modules', '.bin'),
							join(root, 'node_modules', '.bin'),
							process.env.PATH,
						].join(delimiter),
					},
				});
				let stderr = '';
				child.stderr.on('data', (chunk: Buffer) => {
					stderr += chunk.toString();
				});
				child.on('error', (error: NodeJS.ErrnoException) =>
					reject(
						error.code === 'ENOENT'
							? new EasCliMissing(dir)
							: new EasCommandFailed('env:set', null, error.message),
					),
				);
				child.on('close', (code) =>
					code === 0
						? resolve()
						: reject(
								new EasCommandFailed(`env:set --name ${name}`, code, stderr),
							),
				);
			});
		},
	};
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

	const declarations = Object.values(manifest).filter(
		(declaration): declaration is MobileAppDeclaration =>
			declaration.kind === 'mobile-app',
	);
	const names = declarations.map((declaration) => appKey(declaration.id));
	if (declarations.length === 0) throw new NoMobileApp();
	const name =
		options.app ??
		(loaded.appName && names.includes(loaded.appName)
			? loaded.appName
			: names.length === 1
				? names[0]
				: undefined);
	if (!name) throw new MobileAppNotChosen(names);
	const declaration = declarations.find((d) => appKey(d.id) === name);
	if (!declaration) throw new MobileAppUnknown(name, names);

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
		return { app: name, dir, stage, values, easJsonChanged };
	}

	logger.log(`📱 ${where}`);
	if (easJsonChanged) {
		await writeFile(path, `${JSON.stringify(after, null, 2)}\n`);
		logger.log(
			`   wrote build.${stage.stage} and submit.${stage.stage} in ${path}`,
		);
	}
	const cli = eas ?? easCli(workspace.root);
	for (const [key, value] of Object.entries(values)) {
		await cli.setEnv(dir, { environment: stage.environment, name: key, value });
		logger.log(`   set ${key}`);
	}
	return { app: name, dir, stage, values, easJsonChanged };
}
