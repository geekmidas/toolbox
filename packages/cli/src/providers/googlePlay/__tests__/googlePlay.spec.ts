import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
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
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import {
	loadComposeApp,
	WARM_TIMEOUT,
	warmComposeApp,
	writeComposeApp,
} from '../../../compose/__tests__/__helpers__/composeApp';
import { deployIdentity } from '../../../deploy/identity';
import type { ResourceRecord } from '../../../deploy/StateStore';
import { stageProvider } from '../../config';
import { GoogleProjectChanged } from '../../google/project';
import type { EnsureContext, ProvisionAction } from '../../types';
import type { GooglePlayConfig } from '../config';
import { easApi } from '../easApi';
import {
	createGooglePlayProvider,
	type GooglePlayCredential,
	MobileAppStoreIdentityMissing,
	PlaySetupNeedsPerson,
} from '../index';
import { PlayKeyUnverified } from '../play';

/**
 * The `google-play` provider's `ensure()` against Google and EAS stood in
 * for by MSW, with
 * the shapes their APIs answer: Resource Manager v3 and Service Usage
 * operations, IAM service accounts and keys (`privateKeyData` base64 JSON),
 * Play's users and grants, edits and data safety, Google's token endpoint —
 * which checks the JWT the new key signs — and EAS's GraphQL.
 */

const PACKAGE = 'com.shop.app';
const DEVELOPER = '1234567890';
const PROJECT_ID = 'eas-project-1';
const PROJECT = 'compose-app-play';
const EMAIL = `compose-app-play@${PROJECT}.iam.gserviceaccount.com`;
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const USER_TOKEN = 'ya29.person';
const KEY_TOKEN = 'ya29.service-account';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	publicKeyEncoding: { type: 'spki', format: 'pem' },
});

interface Recorded {
	method: string;
	url: string;
	auth: string | null;
	quota: string | null;
	body?: unknown;
}

/** What Google and EAS hold, across one test's runs. */
let google: {
	projects: Set<string>;
	enabled: Set<string>;
	accounts: Set<string>;
	keys: Map<string, string[]>;
	nextKey: number;
	apps: Set<string>;
	users: Map<string, Record<string, string[]>>;
	edits: number;
	dataSafety?: string;
	/** The app has had no upload: Play refuses the person's edits. */
	noUpload: boolean;
	/** Whether the service account's token works for Play yet. */
	keyAccepted: boolean;
};
let eas: {
	keys: { id: string; clientEmail: string; privateKeyIdentifier: string }[];
	credentials?: { id: string; submissionsKeyId?: string };
	uploaded: Record<string, unknown>[];
};
let requests: Recorded[];

const record = async (request: Request, body?: unknown) => {
	const url = new URL(request.url);
	requests.push({
		method: request.method,
		url: `${url.origin}${url.pathname}`,
		auth: request.headers.get('authorization'),
		quota: request.headers.get('x-goog-user-project'),
		...(body !== undefined ? { body } : {}),
	});
};
const json = async (request: Request) =>
	request.headers.get('content-type')?.includes('json')
		? await request.clone().json()
		: undefined;

const PLAY = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

const server = setupServer(
	// Resource Manager.
	http.get(
		'https://cloudresourcemanager.googleapis.com/v3/projects/:project',
		async ({ request, params }) => {
			await record(request);
			return google.projects.has(params.project as string)
				? HttpResponse.json({ projectId: params.project })
				: HttpResponse.json(
						{ error: { message: 'not found or no permission' } },
						{ status: 403 },
					);
		},
	),
	http.post(
		'https://cloudresourcemanager.googleapis.com/v3/projects',
		async ({ request }) => {
			const body = (await json(request)) as { projectId: string };
			await record(request, body);
			google.projects.add(body.projectId);
			return HttpResponse.json({ name: 'operations/cp.1', done: true });
		},
	),
	// Service Usage.
	http.post(
		'https://serviceusage.googleapis.com/v1/projects/:project/services/:service',
		async ({ request, params }) => {
			await record(request);
			google.enabled.add(String(params.service).replace(':enable', ''));
			return HttpResponse.json({ name: 'operations/acf.1', done: true });
		},
	),
	// IAM.
	http.get(
		'https://iam.googleapis.com/v1/projects/:project/serviceAccounts/:email/keys',
		async ({ request, params }) => {
			await record(request);
			const email = String(params.email);
			return HttpResponse.json({
				keys: (google.keys.get(email) ?? []).map((id) => ({
					name: `projects/${params.project}/serviceAccounts/${email}/keys/${id}`,
				})),
			});
		},
	),
	http.post(
		'https://iam.googleapis.com/v1/projects/:project/serviceAccounts/:email/keys',
		async ({ request, params }) => {
			await record(request);
			const email = String(params.email);
			const id = `key${++google.nextKey}`;
			google.keys.set(email, [...(google.keys.get(email) ?? []), id]);
			const file = {
				type: 'service_account',
				project_id: params.project,
				private_key_id: id,
				private_key: privateKey,
				client_email: email,
				token_uri: TOKEN_URI,
			};
			return HttpResponse.json({
				name: `projects/${params.project}/serviceAccounts/${email}/keys/${id}`,
				privateKeyData: Buffer.from(JSON.stringify(file)).toString('base64'),
			});
		},
	),
	http.delete(
		'https://iam.googleapis.com/v1/projects/:project/serviceAccounts/:email/keys/:id',
		async ({ request, params }) => {
			await record(request);
			const email = String(params.email);
			google.keys.set(
				email,
				(google.keys.get(email) ?? []).filter((id) => id !== params.id),
			);
			return HttpResponse.json({});
		},
	),
	http.get(
		'https://iam.googleapis.com/v1/projects/:project/serviceAccounts/:email',
		async ({ request, params }) => {
			await record(request);
			return google.accounts.has(String(params.email))
				? HttpResponse.json({ email: params.email })
				: HttpResponse.json(
						{ error: { message: 'Not found' } },
						{ status: 404 },
					);
		},
	),
	http.post(
		'https://iam.googleapis.com/v1/projects/:project/serviceAccounts',
		async ({ request, params }) => {
			const body = (await json(request)) as { accountId: string };
			await record(request, body);
			google.accounts.add(
				`${body.accountId}@${params.project}.iam.gserviceaccount.com`,
			);
			return HttpResponse.json({});
		},
	),
	// Google's token endpoint: a JWT signed with the key, or nothing.
	http.post(TOKEN_URI, async ({ request }) => {
		const form = new URLSearchParams(await request.text());
		const [header, claims, signature] = (form.get('assertion') ?? '').split(
			'.',
		);
		const valid = createVerify('RSA-SHA256')
			.update(`${header}.${claims}`)
			.verify(publicKey, Buffer.from(signature ?? '', 'base64url'));
		const payload = JSON.parse(
			Buffer.from(claims ?? '', 'base64url').toString(),
		);
		if (!valid || payload.iss !== EMAIL || payload.aud !== TOKEN_URI) {
			return HttpResponse.json(
				{ error: 'invalid_grant', error_description: 'bad signature' },
				{ status: 400 },
			);
		}
		return HttpResponse.json({ access_token: KEY_TOKEN });
	}),
	// Play users and grants.
	http.get(`${PLAY}/developers/:developer/users`, async ({ request }) => {
		await record(request);
		return HttpResponse.json({
			users: [...google.users].map(([email, grants]) => ({
				email,
				grants: Object.entries(grants).map(([packageName, permissions]) => ({
					packageName,
					appLevelPermissions: permissions,
				})),
			})),
		});
	}),
	http.post(`${PLAY}/developers/:developer/users`, async ({ request }) => {
		const body = (await json(request)) as {
			email: string;
			grants: { packageName: string; appLevelPermissions: string[] }[];
		};
		await record(request, body);
		const grant = body.grants[0]!;
		if (!google.apps.has(grant.packageName)) {
			return HttpResponse.json(
				{
					error: {
						message: `The following packages are not available: ${grant.packageName}.`,
					},
				},
				{ status: 400 },
			);
		}
		google.users.set(body.email, {
			[grant.packageName]: grant.appLevelPermissions,
		});
		return HttpResponse.json({ email: body.email, accessState: 'INVITED' });
	}),
	http.patch(
		`${PLAY}/developers/:developer/users/:email/grants/:package`,
		async ({ request, params }) => {
			const body = (await json(request)) as { appLevelPermissions: string[] };
			await record(request, body);
			google.users.get(String(params.email))![String(params.package)] =
				body.appLevelPermissions;
			return HttpResponse.json({});
		},
	),
	// Edits, listings, images, data safety.
	http.post(`${PLAY}/applications/:package/edits`, async ({ request }) => {
		await record(request);
		if (
			request.headers.get('authorization') === `Bearer ${USER_TOKEN}` &&
			google.noUpload
		) {
			return HttpResponse.json(
				{ error: { message: 'This app has no uploaded bundle yet.' } },
				{ status: 400 },
			);
		}
		if (
			request.headers.get('authorization') === `Bearer ${KEY_TOKEN}` &&
			!google.keyAccepted
		) {
			return HttpResponse.json(
				{ error: { message: 'The caller does not have permission' } },
				{ status: 403 },
			);
		}
		return HttpResponse.json({ id: `edit${++google.edits}` });
	}),
	http.delete(
		`${PLAY}/applications/:package/edits/:edit`,
		async ({ request }) => {
			await record(request);
			return new HttpResponse(null, { status: 204 });
		},
	),
	http.put(
		`${PLAY}/applications/:package/edits/:edit/listings/:language`,
		async ({ request }) => {
			await record(request, await json(request));
			return HttpResponse.json({});
		},
	),
	http.delete(
		`${PLAY}/applications/:package/edits/:edit/listings/:language/:type`,
		async ({ request }) => {
			await record(request);
			return HttpResponse.json({ deleted: [] });
		},
	),
	http.post(
		'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/:package/edits/:edit/listings/:language/:type',
		async ({ request }) => {
			await record(request, request.headers.get('content-type'));
			return HttpResponse.json({ image: {} });
		},
	),
	http.post(
		`${PLAY}/applications/:package/edits/:commit`,
		async ({ request }) => {
			await record(request);
			return HttpResponse.json({});
		},
	),
	http.post(`${PLAY}/applications/:package/dataSafety`, async ({ request }) => {
		const body = (await json(request)) as { safetyLabels: string };
		await record(request, body);
		google.dataSafety = body.safetyLabels;
		return HttpResponse.json({});
	}),
	// EAS.
	http.post('https://api.expo.dev/graphql', async ({ request }) => {
		const body = (await json(request)) as {
			operationName: string;
			variables: Record<string, unknown>;
		};
		await record(request, body.operationName);
		const v = body.variables;
		const key = (id?: string) => eas.keys.find((k) => k.id === id) ?? null;
		const credentials = () =>
			eas.credentials && {
				id: eas.credentials.id,
				googleServiceAccountKeyForSubmissions: key(
					eas.credentials.submissionsKeyId,
				),
			};
		switch (body.operationName) {
			case 'AppByIdQuery':
				return HttpResponse.json({
					data: {
						app: {
							byId: {
								id: v.appId,
								fullName: '@acme/shop',
								ownerAccount: { id: 'account-1', name: 'acme' },
							},
						},
					},
				});
			case 'AndroidAppCredentialsByApplicationIdentifierQuery':
				return HttpResponse.json({
					data: {
						app: {
							byFullName: {
								id: PROJECT_ID,
								androidAppCredentials: eas.credentials ? [credentials()] : [],
							},
						},
					},
				});
			case 'CreateAndroidAppCredentialsMutation':
				eas.credentials = { id: 'credentials-1' };
				return HttpResponse.json({
					data: {
						androidAppCredentials: {
							createAndroidAppCredentials: credentials(),
						},
					},
				});
			case 'CreateGoogleServiceAccountKeyMutation': {
				const jsonKey = (
					v.googleServiceAccountKeyInput as { jsonKey: Record<string, unknown> }
				).jsonKey;
				eas.uploaded.push(jsonKey);
				const created = {
					id: `eas-key-${eas.keys.length + 1}`,
					clientEmail: String(jsonKey.client_email),
					privateKeyIdentifier: String(jsonKey.private_key_id),
				};
				eas.keys.push(created);
				return HttpResponse.json({
					data: {
						googleServiceAccountKey: { createGoogleServiceAccountKey: created },
					},
				});
			}
			case 'SetGoogleServiceAccountKeyForSubmissionsMutation':
				eas.credentials!.submissionsKeyId = String(v.googleServiceAccountKeyId);
				return HttpResponse.json({
					data: {
						androidAppCredentials: {
							setGoogleServiceAccountKeyForSubmissions: {
								id: eas.credentials!.id,
							},
						},
					},
				});
			case 'GoogleServiceAccountKeysPaginatedByAccountQuery':
				return HttpResponse.json({
					data: {
						account: {
							byName: {
								id: 'account-1',
								googleServiceAccountKeysPaginated: {
									edges: eas.keys.map((node) => ({ node })),
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						},
					},
				});
			case 'ViewBuildsOnAppQuery':
				return HttpResponse.json({
					data: {
						app: {
							byId: {
								id: v.appId,
								builds: [
									{
										id: 'build-1',
										artifacts: {
											buildUrl: 'https://expo.dev/artifacts/eas/build-1.aab',
										},
									},
								],
							},
						},
					},
				});
			case 'DeleteGoogleServiceAccountKeyMutation':
				eas.keys = eas.keys.filter((k) => k.id !== v.googleServiceAccountKeyId);
				return HttpResponse.json({
					data: {
						googleServiceAccountKey: {
							deleteGoogleServiceAccountKey: {
								id: v.googleServiceAccountKeyId,
							},
						},
					},
				});
			default:
				return HttpResponse.json({
					errors: [{ message: 'unknown operation' }],
				});
		}
	}),
);

let dir: string;
let appDir: string;
/** The stage's deploy state, across one test's runs. */
let records: Map<string, ResourceRecord>;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

beforeAll(warmComposeApp, WARM_TIMEOUT);

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-google-play-'));
	appDir = join(dir, 'apps', 'app');
	vi.stubEnv('GKM_HOME', join(dir, '.home'));
	google = {
		projects: new Set(),
		enabled: new Set(),
		accounts: new Set(),
		keys: new Map(),
		nextKey: 0,
		apps: new Set([PACKAGE]),
		users: new Map(),
		edits: 0,
		noUpload: false,
		keyAccepted: true,
	};
	eas = { keys: [], uploaded: [] };
	requests = [];
	records = new Map();
});

afterEach(async () => {
	server.resetHandlers();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await cleanupDir(dir);
});

const PLAY_STAGE = {
	production: { provider: 'google-play', developer: DEVELOPER },
};

/** The fixture with its `MobileApp` known to Play and EAS, on `google-play`. */
function writeApp(
	options: Parameters<typeof writeComposeApp>[1] = {},
	mobile: {
		android?: { package: string };
		eas?: { projectId: string };
	} = {
		android: { package: PACKAGE },
		eas: { projectId: PROJECT_ID },
	},
): void {
	writeComposeApp(dir, {
		target: 'compose',
		mobile,
		deployMobile: PLAY_STAGE,
		...options,
	});
}

interface RunOptions {
	/** Where the Google sign-in comes from: gcloud, or CI's credentials file. */
	source?: 'gcloud' | 'file';
	interactive?: boolean;
	rotateKeys?: boolean;
	dryRun?: boolean;
	/** `--project`. */
	project?: string;
	/** Stands in for waiting: what happens while gkm waits. */
	sleep?: (ms: number) => void;
}

/** One deploy's `ensure()` of the provider, as `provisionStage` runs it. */
async function ensure(options: RunOptions = {}) {
	const { workspace, manifest } = await loadComposeApp(dir);
	const choice = stageProvider(workspace, 'mobile', 'production');
	if (choice.mode !== 'provider') throw new Error('not on google-play');
	const slept: number[] = [];
	const provider = createGooglePlayProvider({
		eas: (token) => easApi(token),
		sleep: async (ms) => {
			slept.push(ms);
			options.sleep?.(ms);
		},
	});
	const actions: ProvisionAction[] = [];
	const logs: string[] = [];
	const dryRun = options.dryRun ?? false;
	const ctx: EnsureContext<GooglePlayConfig, GooglePlayCredential> = {
		workspace,
		manifest,
		stage: 'production',
		identity: deployIdentity(workspace, 'production'),
		config: choice.config as GooglePlayConfig,
		credential: {
			google: {
				signIn: { token: async () => USER_TOKEN },
				source: options.source ?? 'gcloud',
				interactive: options.interactive ?? false,
				...(options.project ? { project: options.project } : {}),
			},
			eas: easApi('expo-token'),
		},
		secrets: {},
		state: {
			record: (key) => records.get(key),
			pending: async () => {},
			ready: async (entry, id) => {
				records.set(entry.key, {
					key: entry.key,
					type: entry.type,
					id,
					status: 'ready',
					updatedAt: new Date().toISOString(),
				} as ResourceRecord);
			},
		},
		dryRun,
		rotateKeys: options.rotateKeys ?? false,
		retireOldKeys: false,
		async change(action, apply) {
			if (!dryRun) await apply();
			actions.push(action);
		},
		writeSecrets: async () => {},
		writeDns: async () => ({ manual: [] }),
		log: (line) => logs.push(line),
	};
	await provider.ensure(ctx);
	return { actions, logs: logs.join('\n'), slept };
}

const called = (method: string, fragment: string) =>
	requests.filter((r) => r.method === method && r.url.includes(fragment));

/** The key EAS submits the app with, as Google knows it. */
const submitKey = () =>
	eas.keys.find((k) => k.id === eas.credentials?.submissionsKeyId)
		?.privateKeyIdentifier;

describe('a MobileApp on google-play, set up by the deploy', () => {
	it('sets up everything from nothing, in one deploy', async () => {
		writeApp();

		const { actions, logs } = await ensure();

		// Google: the project, the API, the account.
		expect(google.projects.has(PROJECT)).toBe(true);
		expect(google.enabled.has('androidpublisher.googleapis.com')).toBe(true);
		expect(google.accounts.has(EMAIL)).toBe(true);

		// Play: invited with a grant on the app alone; no stage ships to
		// production (none is protected), so no production release.
		const invite = called('POST', `/developers/${DEVELOPER}/users`)[0]!;
		expect(invite.body).toEqual({
			email: EMAIL,
			grants: [
				{
					packageName: PACKAGE,
					appLevelPermissions: ['CAN_MANAGE_TRACK_APKS'],
				},
			],
		});
		expect(invite.quota).toBe(PROJECT);

		// EAS: the whole key file uploaded, and assigned for submissions.
		expect(eas.uploaded).toHaveLength(1);
		expect(eas.uploaded[0]).toMatchObject({
			type: 'service_account',
			client_email: EMAIL,
		});
		expect(eas.credentials).toEqual({
			id: 'credentials-1',
			submissionsKeyId: 'eas-key-1',
		});

		// Proved with the key's own token.
		expect(
			called('POST', `/applications/${PACKAGE}/edits`).some(
				(r) => r.auth === `Bearer ${KEY_TOKEN}`,
			),
		).toBe(true);

		// Recorded where the stage's project is kept; the key never printed.
		expect(records.get('google-project:mobile')?.id).toBe(PROJECT);
		expect(actions.map((a) => a.resource)).toEqual([
			`Google Cloud project ${PROJECT}`,
			`Play access for ${EMAIL} on ${PACKAGE}`,
			`EAS Submit key of ${EMAIL}`,
		]);
		expect(logs).not.toContain('PRIVATE KEY');
		expect(logs).toContain('Content rating');
	});

	it('keeps the key on a later deploy, and changes nothing', async () => {
		writeApp();
		await ensure();
		const key = submitKey();
		requests = [];

		const { actions } = await ensure();

		expect(actions).toEqual([]);
		expect(submitKey()).toBe(key);
		expect(google.keys.get(EMAIL)).toEqual([key]);
		expect(called('POST', '/keys')).toEqual([]);
	});

	it('rotates the key with --rotate-keys, deleting the old one from Google and EAS', async () => {
		writeApp();
		await ensure();
		const first = {
			google: submitKey(),
			eas: eas.credentials?.submissionsKeyId,
		};

		await ensure({ rotateKeys: true });

		expect(submitKey()).not.toBe(first.google);
		expect(google.keys.get(EMAIL)).toEqual([submitKey()]);
		expect(eas.keys.map((k) => k.id)).toEqual([
			eas.credentials?.submissionsKeyId,
		]);
		expect(eas.keys.map((k) => k.id)).not.toContain(first.eas);
		// Found, not made again.
		expect(called('POST', 'cloudresourcemanager')).toHaveLength(1);
	});

	it('issues a key when the one EAS holds is no longer live in Google', async () => {
		writeApp();
		await ensure();
		google.keys.set(EMAIL, []);

		await ensure();

		expect(google.keys.get(EMAIL)).toEqual([submitKey()]);
		expect(eas.uploaded).toHaveLength(2);
	});

	it('grants production releases once a stage submits to production', async () => {
		// Granted testing tracks by an earlier run, before the stage shipped
		// to production — now it is protected, and does.
		writeApp({ protected: ['production'] });
		google.users.set(EMAIL, { [PACKAGE]: ['CAN_MANAGE_TRACK_APKS'] });

		await ensure();

		expect(called('PATCH', '/grants/')[0]!.body).toEqual({
			appLevelPermissions: ['CAN_MANAGE_PUBLIC_APKS', 'CAN_MANAGE_TRACK_APKS'],
		});
	});

	it('leaves an app not in Play Console pending, with no key made, and says what to create', async () => {
		writeApp();
		google.apps.clear();

		const { logs } = await ensure();

		expect(google.keys.get(EMAIL) ?? []).toEqual([]);
		expect(eas.uploaded).toEqual([]);
		expect(logs).toContain(`${PACKAGE}: pending`);
		expect(logs).toContain(
			`https://play.google.com/console/developers/${DEVELOPER}/create-new-app`,
		);
		expect(logs).toContain('default language');
	});

	it('waits for the app, with someone here to make it', async () => {
		writeApp();
		google.apps.clear();

		const { slept } = await ensure({
			interactive: true,
			// Made in Play Console while gkm waits.
			sleep: () => google.apps.add(PACKAGE),
		});

		expect(slept).toEqual([15_000]);
		expect(google.users.get(EMAIL)).toEqual({
			[PACKAGE]: ['CAN_MANAGE_TRACK_APKS'],
		});
	});

	it('keeps the old key when the new one cannot reach the app', async () => {
		writeApp();
		await ensure();
		const first = {
			google: submitKey(),
			eas: eas.credentials?.submissionsKeyId,
		};
		google.keyAccepted = false;

		await expect(ensure({ rotateKeys: true })).rejects.toThrow(
			PlayKeyUnverified,
		);

		expect(google.keys.get(EMAIL)).toContain(first.google);
		expect(eas.keys.map((k) => k.id)).toContain(first.eas);
	});

	it('pushes the store listing kept beside the app, once until it changes', async () => {
		writeApp();
		const listing = join(appDir, 'store', 'play', 'listings', 'en-US');
		mkdirSync(join(listing, 'images', 'phoneScreenshots'), { recursive: true });
		writeFileSync(join(listing, 'title.txt'), 'Shop\n');
		writeFileSync(join(listing, 'short_description.txt'), 'Buy things.\n');
		writeFileSync(
			join(listing, 'full_description.txt'),
			'Buy all the things.\n',
		);
		writeFileSync(join(listing, 'images', 'icon.png'), 'png');
		writeFileSync(join(listing, 'images', 'phoneScreenshots', '1.png'), 'png');
		writeFileSync(join(listing, 'images', 'phoneScreenshots', '2.jpg'), 'jpg');
		writeFileSync(
			join(appDir, 'store', 'play', 'data-safety.csv'),
			'Question,Answer\n',
		);

		await ensure();
		await ensure();
		writeFileSync(join(listing, 'title.txt'), 'Shop!\n');
		await ensure();

		expect(google.users.get(EMAIL)?.[PACKAGE]).toContain(
			'CAN_MANAGE_PUBLIC_LISTING',
		);
		expect(called('PUT', '/listings/en-US').map((r) => r.body)).toEqual([
			{
				language: 'en-US',
				title: 'Shop',
				shortDescription: 'Buy things.',
				fullDescription: 'Buy all the things.',
			},
			{
				language: 'en-US',
				title: 'Shop!',
				shortDescription: 'Buy things.',
				fullDescription: 'Buy all the things.',
			},
		]);
		expect(
			called('POST', '/upload/')
				.slice(0, 3)
				.map((r) => [r.url.split('/').pop(), r.body]),
		).toEqual([
			['icon', 'image/png'],
			['phoneScreenshots', 'image/png'],
			['phoneScreenshots', 'image/jpeg'],
		]);
		expect(called('POST', ':commit')).toHaveLength(2);
		expect(google.dataSafety).toBe('Question,Answer');
	});

	it('names the EAS store build to upload when Play has no build of the app yet', async () => {
		writeApp();
		const listing = join(appDir, 'store', 'play', 'listings', 'en-US');
		mkdirSync(listing, { recursive: true });
		writeFileSync(join(listing, 'title.txt'), 'Shop\n');
		google.noUpload = true;

		const { logs } = await ensure();

		expect(logs).toContain('https://expo.dev/artifacts/eas/build-1.aab');
		expect(records.has('google-play-listing:App')).toBe(false);
	});

	it('in CI, only checks the key EAS holds — and leaves a missing one pending', async () => {
		writeApp();

		const { logs } = await ensure({ source: 'file' });

		expect(logs).toContain(`${PACKAGE}: EAS has no live key of ${EMAIL}`);
		expect(called('POST', 'cloudresourcemanager')).toEqual([]);
		expect(called('POST', '/users')).toEqual([]);
		expect(called('POST', '/keys')).toEqual([]);
	});

	it('in CI, finds the key a deploy from a terminal set up', async () => {
		writeApp();
		await ensure();
		requests = [];

		const { logs } = await ensure({ source: 'file' });

		expect(logs).toContain(
			`${PACKAGE}: EAS Submit's key is ${EMAIL}'s, and live`,
		);
		expect(
			requests.filter((r) => r.method !== 'GET').map((r) => r.url),
		).toEqual(['https://api.expo.dev/graphql', 'https://api.expo.dev/graphql']);
	});

	it('refuses to rotate the key from CI', async () => {
		writeApp();

		await expect(ensure({ source: 'file', rotateKeys: true })).rejects.toThrow(
			PlaySetupNeedsPerson,
		);
	});

	it('keeps the stage in the project it was set up in', async () => {
		writeApp();
		await ensure();

		await expect(ensure({ project: 'another-project' })).rejects.toThrow(
			GoogleProjectChanged,
		);
	});

	it('plans, and touches nothing, on a dry run', async () => {
		writeApp();

		const { actions } = await ensure({ dryRun: true });

		expect(actions.map((a) => a.change)).toEqual(['set up']);
		expect(requests).toEqual([]);
		expect(records.size).toBe(0);
	});

	it.for([
		['android.package', { eas: { projectId: PROJECT_ID } }],
		['eas.projectId', { android: { package: PACKAGE } }],
	] as const)('needs the MobileApp to say its %s', async ([
		missing,
		mobile,
	]) => {
		writeApp({}, mobile);

		const error = await ensure().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(MobileAppStoreIdentityMissing);
		expect((error as MobileAppStoreIdentityMissing).missing).toBe(missing);
		expect(requests).toEqual([]);
	});
});

describe("the google-play provider's credentials", () => {
	it('are none without an Expo access token', async () => {
		const provider = createGooglePlayProvider();

		expect(
			await provider.credentials({
				stage: 'production',
				env: { GOOGLE_APPLICATION_CREDENTIALS: '/ci/credentials.json' },
			}),
		).toBeUndefined();
	});

	it('are the CI credentials file and EAS, with both', async () => {
		const provider = createGooglePlayProvider();

		const credential = await provider.credentials({
			stage: 'production',
			env: {
				GOOGLE_APPLICATION_CREDENTIALS: '/ci/credentials.json',
				EXPO_TOKEN: 'expo-token',
			},
			project: 'acme-play',
		});

		expect(credential?.google).toMatchObject({
			source: 'file',
			project: 'acme-play',
		});
	});
});
