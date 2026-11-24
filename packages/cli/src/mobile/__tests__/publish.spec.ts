import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	WARM_TIMEOUT,
	warmComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { easApi } from '../../providers/googlePlay/easApi';
import { easCli } from '../eas';
import {
	NoStoreBuildForUpdate,
	PlaySubmitKeyMissing,
	publish,
} from '../publish';
import {
	deployedMobileApp,
	easRecorder,
	easStandIn,
	easStandInCalls,
} from './__helpers__/mobileApp';

/**
 * `gkm publish`: the compose fixture's `MobileApp` on its deployed stage,
 * synced to EAS, then an update or a store build per platform — `eas` a
 * recorder, or a stand-in on PATH where its own arguments are the point.
 */

let dir: string;
let appDir: string;

beforeAll(warmComposeApp, WARM_TIMEOUT);

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-publish-'));
	appDir = join(dir, 'apps', 'app');
	vi.stubEnv('GKM_HOME', join(dir, '.home'));
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await cleanupDir(dir);
});

/** Whether EAS holds a Play key for the app, as its GraphQL answers. */
let submissionsKey: boolean;

const server = setupServer(
	http.post('https://api.expo.dev/graphql', async ({ request }) => {
		const body = (await request.json()) as { operationName: string };
		if (body.operationName === 'AppByIdQuery') {
			return HttpResponse.json({
				data: {
					app: {
						byId: {
							id: 'eas-project-1',
							fullName: '@acme/shop',
							ownerAccount: { id: 'account-1', name: 'acme' },
						},
					},
				},
			});
		}
		return HttpResponse.json({
			data: {
				app: {
					byFullName: {
						id: 'eas-project-1',
						androidAppCredentials: [
							{
								id: 'credentials-1',
								googleServiceAccountKeyForSubmissions: submissionsKey
									? {
											id: 'eas-key-1',
											clientEmail:
												'shop-play@shop-play.iam.gserviceaccount.com',
											privateKeyIdentifier: 'key1',
										}
									: null,
							},
						],
					},
				},
			},
		});
	}),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

const releases = (calls: ReturnType<typeof easRecorder>['calls']) =>
	calls.filter((call) => call.op === 'build' || call.op === 'update');

describe('gkm publish', () => {
	it('builds and submits where no store build has the native code', async () => {
		await deployedMobileApp(dir, { protected: ['production'] });
		const { eas, calls } = easRecorder();

		const done = await publish({ stage: 'production', cwd: appDir }, eas);

		// Synced first: the values are in the stage's environment before it
		// is built.
		const first = calls.findIndex((call) => call.op === 'fingerprint');
		expect(calls.slice(0, first).every((call) => call.op === 'setEnv')).toBe(
			true,
		);
		expect(calls).toContainEqual({
			op: 'fingerprint',
			platform: 'android',
			profile: 'production',
		});
		expect(releases(calls)).toEqual([
			// No ascAppId: iOS is built, not submitted.
			{
				op: 'build',
				platform: 'ios',
				profile: 'production',
				submit: false,
				wait: false,
			},
			{
				op: 'build',
				platform: 'android',
				profile: 'production',
				submit: true,
				wait: false,
			},
		]);
		expect(done.map((release) => release.release)).toEqual(['build', 'build']);
		const said = vi.mocked(console.log).mock.calls.flat().join('\n');
		expect(said).toContain('submit.production.ios.ascAppId is not set');
		expect(said).toContain("Play's production track (draft)");
	});

	it("updates the stage's channel where a store build has the native code", async () => {
		await deployedMobileApp(dir);
		const { eas, calls } = easRecorder({ 'fp-android': 'build-android-1' });

		const done = await publish(
			{
				stage: 'production',
				cwd: appDir,
				platform: 'android',
				message: 'Fix the food log',
			},
			eas,
		);

		expect(releases(calls)).toEqual([
			{
				op: 'update',
				platform: 'android',
				channel: 'production',
				environment: 'preview',
				message: 'Fix the food log',
			},
		]);
		expect(done).toEqual([
			{
				platform: 'android',
				fingerprint: 'fp-android',
				storeBuild: 'build-android-1',
				release: 'update',
				submit: false,
			},
		]);
	});

	it('submits iOS once its App Store Connect app is set', async () => {
		await deployedMobileApp(dir);
		writeFileSync(
			join(appDir, 'eas.json'),
			JSON.stringify({ submit: { production: { ios: { ascAppId: '123' } } } }),
		);
		const { eas, calls } = easRecorder();

		await publish(
			{ stage: 'production', cwd: appDir, platform: 'ios', wait: true },
			eas,
		);

		expect(releases(calls)).toEqual([
			{
				op: 'build',
				platform: 'ios',
				profile: 'production',
				submit: true,
				wait: true,
			},
		]);
	});

	it('builds when told to, without asking for a store build', async () => {
		await deployedMobileApp(dir);
		const { eas, calls } = easRecorder({ 'fp-android': 'build-android-1' });

		await publish(
			{ stage: 'production', cwd: appDir, platform: 'android', mode: 'build' },
			eas,
		);

		expect(calls.map((call) => call.op)).not.toContain('storeBuild');
		expect(releases(calls).map((call) => call.op)).toEqual(['build']);
	});

	it('refuses an update no store build would receive', async () => {
		await deployedMobileApp(dir);
		const { eas, calls } = easRecorder();

		await expect(
			publish(
				{
					stage: 'production',
					cwd: appDir,
					platform: 'android',
					mode: 'update',
				},
				eas,
			),
		).rejects.toThrow(NoStoreBuildForUpdate);
		expect(releases(calls)).toEqual([]);
	});

	it('releases nothing on a dry run, and says what it would', async () => {
		await deployedMobileApp(dir);
		const { eas, calls } = easRecorder({ 'fp-ios': 'build-ios-1' });

		const done = await publish(
			{ stage: 'production', cwd: appDir, dryRun: true },
			eas,
		);

		expect(done.map((release) => release.release)).toEqual(['update', 'build']);
		expect(calls.map((call) => call.op)).not.toContain('setEnv');
		expect(releases(calls)).toEqual([]);
	});
});

describe('the eas it runs to decide', () => {
	it('reads the fingerprint, and a store build with it, from their JSON', async () => {
		const log = easStandIn(appDir, {
			stdout: {
				'fingerprint:generate': '{"hash":"abc123","sources":[]}',
				'build:list': '[{"id":"build-9","status":"FINISHED"}]',
			},
		});
		const cli = easCli(dir);

		const hash = await cli.fingerprint(appDir, {
			platform: 'android',
			profile: 'prod',
		});
		const build = await cli.storeBuild(appDir, {
			platform: 'android',
			profile: 'prod',
			fingerprint: hash,
		});

		expect(hash).toBe('abc123');
		expect(build).toBe('build-9');
		expect(easStandInCalls(log, (path) => readFileSync(path, 'utf8'))).toEqual([
			[
				'fingerprint:generate',
				'--platform',
				'android',
				'--build-profile',
				'prod',
				'--json',
				'--non-interactive',
			],
			[
				'build:list',
				'--platform',
				'android',
				'--build-profile',
				'prod',
				'--fingerprint-hash',
				'abc123',
				'--status',
				'finished',
				'--distribution',
				'store',
				'--limit',
				'1',
				'--json',
				'--non-interactive',
			],
		]);
	});

	it("runs eas with the app's values, which its app.config.ts reads", async () => {
		easStandIn(appDir, {
			stdout: { 'fingerprint:generate': '{"hash":"abc123"}' },
			env: ['EXPO_PUBLIC_API_URL', 'APP_SCHEME'],
		});

		await easCli(dir, {
			EXPO_PUBLIC_API_URL: 'https://api.shop.example.com',
			APP_SCHEME: 'shop',
		}).fingerprint(appDir, { platform: 'ios', profile: 'prod' });

		expect(readFileSync(join(appDir, 'eas-env.txt'), 'utf8')).toBe(
			'EXPO_PUBLIC_API_URL=https://api.shop.example.com\nAPP_SCHEME=shop\n',
		);
	});

	it('finds no store build in an empty list', async () => {
		easStandIn(appDir, { stdout: { 'build:list': '[]' } });

		expect(
			await easCli(dir).storeBuild(appDir, {
				platform: 'ios',
				profile: 'prod',
				fingerprint: 'abc123',
			}),
		).toBeUndefined();
	});

	it('starts a store build without waiting, and submits it when asked', async () => {
		const log = easStandIn(appDir);

		await easCli(dir).build(appDir, {
			platform: 'android',
			profile: 'prod',
			submit: true,
			wait: false,
		});

		expect(easStandInCalls(log, (path) => readFileSync(path, 'utf8'))).toEqual([
			[
				'build',
				'--platform',
				'android',
				'--profile',
				'prod',
				'--auto-submit',
				'--no-wait',
				'--non-interactive',
			],
		]);
	});
});

describe('gkm publish, on a stage the deploy sets up on Google Play', () => {
	const play = {
		mobile: {
			android: { package: 'com.shop.app' },
			eas: { projectId: 'eas-project-1' },
		},
		deployMobile: {
			production: { provider: 'google-play', developer: '5551234567' },
		},
	};

	it('refuses an Android store build EAS holds no key to submit', async () => {
		await deployedMobileApp(dir, play);
		submissionsKey = false;
		const { eas, calls } = easRecorder();

		await expect(
			publish(
				{ stage: 'production', cwd: appDir, platform: 'android' },
				eas,
				() => easApi('expo-token'),
			),
		).rejects.toThrow(PlaySubmitKeyMissing);
		expect(releases(calls)).toEqual([]);
	});

	it('builds and submits once the deploy has set the key up', async () => {
		await deployedMobileApp(dir, play);
		submissionsKey = true;
		const { eas, calls } = easRecorder();

		await publish(
			{ stage: 'production', cwd: appDir, platform: 'android' },
			eas,
			() => easApi('expo-token'),
		);

		expect(releases(calls)).toEqual([
			expect.objectContaining({
				op: 'build',
				platform: 'android',
				submit: true,
			}),
		]);
	});
});
