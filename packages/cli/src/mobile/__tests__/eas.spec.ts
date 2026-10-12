import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { MobileAppDeclaration } from '@geekmidas/manifest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	SERVER_IPV4,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import {
	type Call,
	fakeDocker,
	fakeServer,
} from '../../compose/__tests__/__helpers__/fakeDocker';
import { deployedStackSecrets } from '../../compose/secrets';
import { loadWorkspaceSettings } from '../../config';
import { execOnStage } from '../../exec/stage';
import { secretsStoreFor } from '../../secrets/store';
import {
	type EasCli,
	EasCommandFailed,
	easCli,
	easSync,
	MobileAppNotChosen,
	NoMobileApp,
	withStageProfiles,
} from '../eas';
import { MobileAppStageUndeclared, mobileStage } from '../stage';

/**
 * A mobile app's EAS project set up for a deployed stage: the compose
 * fixture with a `MobileApp`, its secrets in a real store, `eas.json` on
 * disk — and a recorder standing in for `eas`.
 */

let dir: string;

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-eas-sync-'));
	vi.stubEnv('GKM_HOME', join(dir, '.home'));
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await cleanupDir(dir);
});

/** The fixture, deployed: its secrets as its first deploy left them. */
async function deployed(
	options: Parameters<typeof writeComposeApp>[1] = {},
	custom: Record<string, string> = {},
): Promise<void> {
	writeComposeApp(dir, { target: 'compose', mobile: true, ...options });
	const { workspace, manifest } = await loadComposeApp(dir);
	const { secrets } = deployedStackSecrets(
		workspace,
		'production',
		null,
		manifest,
	);
	const store = await secretsStoreFor(
		await loadWorkspaceSettings(dir),
		'production',
	);
	await store.write('production', {
		...secrets,
		custom: {
			...secrets.custom,
			AUTH_SECRET: 'the-production-signing-secret',
			BACKUPS_URL: 's3://K:S@backups?region=eu-west-1',
			GKM_SERVER_IPV4: SERVER_IPV4,
			...custom,
		},
	});
}

/** `eas` as a recorder. */
function recorder() {
	const set: {
		dir: string;
		environment: string;
		name: string;
		value: string;
	}[] = [];
	const eas: EasCli = {
		async setEnv(at, variable) {
			set.push({ dir: at, ...variable });
		},
	};
	return { eas, set };
}

const app = (
	stages?: MobileAppDeclaration['stages'],
): MobileAppDeclaration => ({
	kind: 'mobile-app',
	id: 'App',
	variant: 'expo',
	app: { path: 'apps/app' },
	dependencies: [],
	...(stages ? { stages } : {}),
});

describe("a stage's way of shipping a mobile app", () => {
	const workspace = {
		stages: {
			local: 'development',
			deployed: ['beta', 'prod'],
			protected: ['prod'],
		},
	};

	it('is production for the protected stage, preview and internal for the rest, a draft for all', () => {
		expect(mobileStage(workspace, app(), 'prod')).toEqual({
			stage: 'prod',
			environment: 'production',
			channel: 'prod',
			android: { track: 'production', releaseStatus: 'draft' },
		});
		expect(mobileStage(workspace, app(), 'beta')).toEqual({
			stage: 'beta',
			environment: 'preview',
			channel: 'beta',
			android: { track: 'internal', releaseStatus: 'draft' },
		});
	});

	it('takes what the MobileApp says for a stage over the defaults', () => {
		expect(
			mobileStage(
				workspace,
				app({
					beta: { android: { track: 'alpha', releaseStatus: 'completed' } },
				}),
				'beta',
			),
		).toMatchObject({
			environment: 'preview',
			android: { track: 'alpha', releaseStatus: 'completed' },
		});
	});

	it('refuses a stage the project does not deploy', () => {
		expect(() =>
			mobileStage(
				workspace,
				app({ staging: { environment: 'preview' } }),
				'prod',
			),
		).toThrow(MobileAppStageUndeclared);
	});
});

describe("eas.json's stage profiles", () => {
	it('sets the environment, channel, track and release status, and keeps the rest', () => {
		const easJson = {
			cli: { appVersionSource: 'remote' },
			build: {
				development: { developmentClient: true },
				prod: { corepack: true, autoIncrement: true, environment: 'old' },
			},
			submit: {
				prod: { android: { track: 'internal' }, ios: { ascAppId: '1' } },
			},
		};

		expect(
			withStageProfiles(easJson, {
				stage: 'prod',
				environment: 'production',
				channel: 'prod',
				android: { track: 'production', releaseStatus: 'draft' },
			}),
		).toEqual({
			cli: { appVersionSource: 'remote' },
			build: {
				development: { developmentClient: true },
				prod: {
					corepack: true,
					autoIncrement: true,
					environment: 'production',
					channel: 'prod',
				},
			},
			submit: {
				prod: {
					android: { track: 'production', releaseStatus: 'draft' },
					ios: { ascAppId: '1' },
				},
			},
		});
	});
});

describe('gkm eas:sync', () => {
	it("writes the stage's profiles, and its public values to its EAS environment", async () => {
		await deployed({}, { EXPO_PUBLIC_STORE_URL: 'https://store.example.com' });
		const { eas, set } = recorder();
		const appDir = join(dir, 'apps', 'app');
		writeFileSync(
			join(appDir, 'eas.json'),
			JSON.stringify({ build: { production: { corepack: true } } }),
		);

		const result = await easSync({ stage: 'production', cwd: appDir }, eas);

		// The fixture protects no stage: production reads `preview`.
		expect(result.stage).toMatchObject({
			environment: 'preview',
			android: { track: 'internal', releaseStatus: 'draft' },
		});
		expect(JSON.parse(readFileSync(join(appDir, 'eas.json'), 'utf8'))).toEqual({
			build: {
				production: {
					corepack: true,
					environment: 'preview',
					channel: 'production',
				},
			},
			submit: {
				production: { android: { track: 'internal', releaseStatus: 'draft' } },
			},
		});

		// The public addresses, the scheme and the public stage secret; no
		// server key, and no inbox on a deployed stage.
		const written = Object.fromEntries(set.map((v) => [v.name, v.value]));
		expect(written).toEqual({
			APP_SCHEME: 'compose-app',
			EXPO_PUBLIC_API_URL: 'https://api.shop.example.com',
			EXPO_PUBLIC_AUTH_URL: 'https://auth.shop.example.com',
			EXPO_PUBLIC_STORE_URL: 'https://store.example.com',
		});
		expect(
			set.every((v) => v.environment === 'preview' && v.dir === appDir),
		).toBe(true);
		expect(JSON.stringify(set)).not.toContain('the-production-signing-secret');
	});

	it("reads the protected stage's production environment, and a stage's override", async () => {
		await deployed({
			protected: ['production'],
			mobile: { stages: { production: { android: { track: 'beta' } } } },
		});
		const { eas, set } = recorder();

		const result = await easSync(
			{ stage: 'production', cwd: join(dir, 'apps', 'app') },
			eas,
		);

		expect(result.stage).toMatchObject({
			environment: 'production',
			android: { track: 'beta', releaseStatus: 'draft' },
		});
		expect(set.every((v) => v.environment === 'production')).toBe(true);
	});

	it('finds the only mobile app from anywhere in the workspace', async () => {
		await deployed();
		const { eas } = recorder();

		const result = await easSync({ stage: 'production', cwd: dir }, eas);

		expect(result.app).toBe('app');
	});

	it('writes nothing on a dry run', async () => {
		await deployed();
		const { eas, set } = recorder();

		const result = await easSync(
			{ stage: 'production', cwd: dir, dryRun: true },
			eas,
		);

		expect(result.easJsonChanged).toBe(true);
		expect(existsSync(join(dir, 'apps', 'app', 'eas.json'))).toBe(false);
		expect(set).toEqual([]);
	});

	it('says there is nothing to do with no mobile app', async () => {
		await deployed({ mobile: false });

		await expect(
			easSync({ stage: 'production', cwd: dir }, recorder().eas),
		).rejects.toThrow(NoMobileApp);
	});

	it('asks for --app among several, run from none of them', () => {
		expect(new MobileAppNotChosen(['app', 'kiosk']).message).toContain(
			'--app app',
		);
	});
});

describe('the eas it runs', () => {
	/** An `eas` in the app's node_modules/.bin that records its arguments. */
	function standIn(appDir: string, exit = 0) {
		const bin = join(appDir, 'node_modules', '.bin');
		mkdirSync(bin, { recursive: true });
		const log = join(appDir, 'eas-args.txt');
		writeFileSync(
			join(bin, 'eas'),
			`#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\necho 'not logged in' >&2\nexit ${exit}\n`,
		);
		chmodSync(join(bin, 'eas'), 0o755);
		return log;
	}

	it('is the app’s own, setting a plaintext project variable without a prompt', async () => {
		const appDir = join(dir, 'app');
		const log = standIn(appDir);

		await easCli(dir).setEnv(appDir, {
			environment: 'production',
			name: 'EXPO_PUBLIC_API_URL',
			value: 'https://api.shop.example.com',
		});

		expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
			'env:set',
			'--environment',
			'production',
			'--name',
			'EXPO_PUBLIC_API_URL',
			'--value',
			'https://api.shop.example.com',
			'--visibility',
			'plaintext',
			'--scope',
			'project',
			'--non-interactive',
		]);
	});

	it('says what eas said when it fails', async () => {
		const appDir = join(dir, 'app');
		standIn(appDir, 1);

		const failed = easCli(dir).setEnv(appDir, {
			environment: 'production',
			name: 'APP_SCHEME',
			value: 'shop',
		});

		await expect(failed).rejects.toThrow(EasCommandFailed);
		await expect(failed).rejects.toThrow('not logged in');
	});
});

describe('gkm exec --stage for a mobile app', () => {
	it('runs with its public values, and needs no server', async () => {
		await deployed();
		const calls: Call[] = [];
		const appDir = join(dir, 'apps', 'app');

		const code = await execOnStage(
			[
				process.execPath,
				'-e',
				`require('fs').writeFileSync('seen.json', JSON.stringify({
					api: process.env.EXPO_PUBLIC_API_URL,
					scheme: process.env.APP_SCHEME,
					secret: process.env.AUTH_SECRET ?? null,
				}))`,
			],
			{ stage: 'production', cwd: appDir },
			{
				docker: fakeDocker().docker,
				server: fakeServer(calls),
				confirm: async () => true,
				env: {},
			},
		);

		expect(code).toBe(0);
		expect(JSON.parse(readFileSync(join(appDir, 'seen.json'), 'utf8'))).toEqual(
			{
				api: 'https://api.shop.example.com',
				scheme: 'compose-app',
				secret: null,
			},
		);
		// No SSH: nothing it reads is on the stack's network.
		expect(calls).toEqual([]);
	});
});
