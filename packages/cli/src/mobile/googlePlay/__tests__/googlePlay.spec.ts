import { createVerify, generateKeyPairSync } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
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
import { deployedMobileApp } from '../../__tests__/__helpers__/mobileApp';
import { easApi } from '../easApi';
import {
	deployGooglePlay,
	type GooglePlayDeps,
	PlayDeveloperMissing,
} from '../index';
import { PlayAppMissing, PlayKeyUnverified } from '../play';

/**
 * `gkm deploy:google-play` against Google and EAS stood in for by MSW, with
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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-google-play-'));
	appDir = join(dir, 'apps', 'app');
	vi.stubEnv('GKM_HOME', join(dir, '.home'));
	vi.spyOn(console, 'log').mockImplementation(() => {});
	google = {
		projects: new Set(),
		enabled: new Set(),
		accounts: new Set(),
		keys: new Map(),
		nextKey: 0,
		apps: new Set([PACKAGE]),
		users: new Map(),
		edits: 0,
		keyAccepted: true,
	};
	eas = { keys: [], uploaded: [] };
	requests = [];
});

afterEach(async () => {
	server.resetHandlers();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await cleanupDir(dir);
});

function deps(overrides: Partial<GooglePlayDeps> = {}): GooglePlayDeps & {
	slept: number[];
} {
	const slept: number[] = [];
	return {
		signIn: { token: async () => USER_TOKEN },
		eas: easApi('expo-token'),
		expoConfig: async () => ({
			android: { package: PACKAGE },
			extra: { eas: { projectId: PROJECT_ID } },
		}),
		interactive: false,
		sleep: async (ms) => {
			slept.push(ms);
		},
		slept,
		...overrides,
	};
}

const called = (method: string, fragment: string) =>
	requests.filter((r) => r.method === method && r.url.includes(fragment));

describe('gkm deploy:google-play', () => {
	it('sets up everything from nothing, in one run', async () => {
		await deployedMobileApp(dir);

		const result = await deployGooglePlay(
			{ developer: DEVELOPER, cwd: appDir },
			deps(),
		);

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
		expect(result.access).toBe('invited');

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

		// Each stage's track in eas.json.
		expect(
			JSON.parse(readFileSync(join(appDir, 'eas.json'), 'utf8')).submit,
		).toEqual({
			production: { android: { track: 'internal', releaseStatus: 'draft' } },
		});

		// The key never reaches the output, and nothing is written but eas.json.
		const said = vi.mocked(console.log).mock.calls.flat().join('\n');
		expect(said).not.toContain('PRIVATE KEY');
		expect(said).toContain('Content rating');
		expect(result.deleted).toEqual({ google: [], eas: [] });
	});

	it('rotates the key on a second run, deleting the old one from Google and EAS', async () => {
		await deployedMobileApp(dir);
		const first = await deployGooglePlay(
			{ developer: DEVELOPER, cwd: appDir },
			deps(),
		);

		const second = await deployGooglePlay(
			{ developer: DEVELOPER, cwd: appDir },
			deps(),
		);

		expect(second.access).toBe('unchanged');
		expect(second.key.google).not.toBe(first.key.google);
		expect(google.keys.get(EMAIL)).toEqual([second.key.google]);
		expect(eas.keys.map((k) => k.id)).toEqual([second.key.eas]);
		expect(eas.credentials?.submissionsKeyId).toBe(second.key.eas);
		expect(second.deleted).toEqual({
			google: [first.key.google],
			eas: [first.key.eas],
		});
		// Found, not made again.
		expect(called('POST', 'cloudresourcemanager')).toHaveLength(1);
		expect(
			called('POST', '/serviceAccounts').filter(
				(r) => !r.url.endsWith('/keys'),
			),
		).toHaveLength(1);
	});

	it('grants production releases once a stage submits to production', async () => {
		// Granted testing tracks by an earlier run, before the stage shipped
		// to production — now it is protected, and does.
		await deployedMobileApp(dir, { protected: ['production'] });
		google.users.set(EMAIL, { [PACKAGE]: ['CAN_MANAGE_TRACK_APKS'] });

		const result = await deployGooglePlay(
			{ developer: DEVELOPER, cwd: appDir },
			deps(),
		);

		expect(result.access).toBe('updated');
		expect(called('PATCH', '/grants/')[0]!.body).toEqual({
			appLevelPermissions: ['CAN_MANAGE_PUBLIC_APKS', 'CAN_MANAGE_TRACK_APKS'],
		});
	});

	it('stops where only a person can make the app, before any key is made', async () => {
		await deployedMobileApp(dir);
		google.apps.clear();

		await expect(
			deployGooglePlay({ developer: DEVELOPER, cwd: appDir }, deps()),
		).rejects.toThrow(PlayAppMissing);
		expect(google.keys.get(EMAIL) ?? []).toEqual([]);
		expect(eas.uploaded).toEqual([]);
	});

	it('waits for the app, with someone here to make it', async () => {
		await deployedMobileApp(dir);
		google.apps.clear();
		const waiting = deps({
			interactive: true,
			sleep: async (ms) => {
				waiting.slept.push(ms);
				// Made in Play Console while gkm waits.
				google.apps.add(PACKAGE);
			},
		});

		const result = await deployGooglePlay(
			{ developer: DEVELOPER, cwd: appDir },
			waiting,
		);

		expect(waiting.slept).toEqual([15_000]);
		expect(result.access).toBe('invited');
	});

	it('keeps the old key when the new one cannot reach the app', async () => {
		await deployedMobileApp(dir);
		const first = await deployGooglePlay(
			{ developer: DEVELOPER, cwd: appDir },
			deps(),
		);
		google.keyAccepted = false;

		await expect(
			deployGooglePlay({ developer: DEVELOPER, cwd: appDir }, deps()),
		).rejects.toThrow(PlayKeyUnverified);

		expect(google.keys.get(EMAIL)).toContain(first.key.google);
		expect(eas.keys.map((k) => k.id)).toContain(first.key.eas);
	});

	it('pushes the store listing and data safety kept beside the app', async () => {
		await deployedMobileApp(dir);
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

		const result = await deployGooglePlay(
			{ developer: DEVELOPER, cwd: appDir },
			deps(),
		);

		expect(result.permissions).toContain('CAN_MANAGE_PUBLIC_LISTING');
		expect(called('PUT', '/listings/en-US')[0]!.body).toEqual({
			language: 'en-US',
			title: 'Shop',
			shortDescription: 'Buy things.',
			fullDescription: 'Buy all the things.',
		});
		expect(
			called('DELETE', '/listings/en-US/').map((r) => r.url.split('/').pop()),
		).toEqual(['icon', 'phoneScreenshots']);
		expect(
			called('POST', '/upload/').map((r) => [r.url.split('/').pop(), r.body]),
		).toEqual([
			['icon', 'image/png'],
			['phoneScreenshots', 'image/png'],
			['phoneScreenshots', 'image/jpeg'],
		]);
		expect(called('POST', ':commit')).toHaveLength(1);
		expect(google.dataSafety).toBe('Question,Answer');
		expect(result.listing).toEqual({ listing: true, dataSafety: true });
	});

	it('needs the Play developer account', async () => {
		await deployedMobileApp(dir);

		await expect(deployGooglePlay({ cwd: appDir }, deps())).rejects.toThrow(
			PlayDeveloperMissing,
		);
		expect(requests).toEqual([]);
		expect(existsSync(join(appDir, 'eas.json'))).toBe(false);
	});
});
