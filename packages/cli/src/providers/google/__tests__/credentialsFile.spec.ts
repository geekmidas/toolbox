import { createVerify, generateKeyPairSync } from 'node:crypto';
import { realpathSync, writeFileSync } from 'node:fs';
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
} from 'vitest';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import {
	credentialsFileToken,
	GoogleCredentialsFileUnreadable,
	GoogleCredentialsTypeUnsupported,
	GoogleTokenExchangeFailed,
} from '../credentialsFile';
import { ANDROID_PUBLISHER_SCOPE, CLOUD_PLATFORM_SCOPE } from '../gcloud';
import { googleSignIn } from '../signIn';

/**
 * The file GOOGLE_APPLICATION_CREDENTIALS names, against STS, IAM
 * Credentials, GitHub's OIDC token endpoint and Google's token endpoint
 * stood in for by MSW, answering in their own shapes.
 */

const AUDIENCE =
	'//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/github/providers/github';
const STS = 'https://sts.googleapis.com/v1/token';
const ACCOUNT = 'gkm-deploy-prod@acme.iam.gserviceaccount.com';
const IMPERSONATE = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${ACCOUNT}:generateAccessToken`;
const GITHUB_TOKEN_PATH =
	'https://pipelines.actions.githubusercontent.com/oidc';
const GITHUB_TOKEN_URL = `${GITHUB_TOKEN_PATH}?audience=x`;

const server = setupServer();
let dir: string;
let calls: { url: string; body: string; auth: string | null }[];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-google-creds-'));
	calls = [];
	server.use(
		http.get(GITHUB_TOKEN_PATH, ({ request }) =>
			request.headers.get('authorization') === 'Bearer gh-request-token' &&
			new URL(request.url).searchParams.get('audience') === 'x'
				? HttpResponse.json({ value: 'github.jwt' })
				: new HttpResponse('no', { status: 401 }),
		),
		http.post(STS, async ({ request }) => {
			const body = await request.text();
			calls.push({ url: STS, body, auth: null });
			const form = new URLSearchParams(body);
			if (form.get('subject_token') !== 'github.jwt') {
				return HttpResponse.json(
					{
						error: 'invalid_grant',
						error_description: 'The given credential is rejected',
					},
					{ status: 400 },
				);
			}
			return HttpResponse.json({ access_token: 'federated' });
		}),
		http.post(IMPERSONATE, async ({ request }) => {
			calls.push({
				url: IMPERSONATE,
				body: await request.text(),
				auth: request.headers.get('authorization'),
			});
			return HttpResponse.json({ accessToken: 'ya29.deploy' });
		}),
	);
});
afterEach(async () => {
	server.resetHandlers();
	await cleanupDir(dir);
});

function file(name: string, value: unknown): string {
	const path = join(dir, name);
	writeFileSync(path, JSON.stringify(value));
	return path;
}

function githubActionsFile(subjectFile?: string): string {
	return file('gha.json', {
		type: 'external_account',
		audience: AUDIENCE,
		subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
		token_url: STS,
		service_account_impersonation_url: IMPERSONATE,
		credential_source: subjectFile
			? { file: subjectFile }
			: {
					url: GITHUB_TOKEN_URL,
					headers: { Authorization: 'Bearer gh-request-token' },
					format: { type: 'json', subject_token_field_name: 'value' },
				},
	});
}

describe('Workload Identity Federation, as google-github-actions/auth writes it', () => {
	it("exchanges the job's token and acts as the deploy account", async () => {
		const path = githubActionsFile();

		const token = await credentialsFileToken(path, [
			CLOUD_PLATFORM_SCOPE,
			ANDROID_PUBLISHER_SCOPE,
		]);

		expect(token).toBe('ya29.deploy');
		const sts = new URLSearchParams(calls[0]!.body);
		expect(Object.fromEntries(sts)).toEqual({
			grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
			audience: AUDIENCE,
			scope: CLOUD_PLATFORM_SCOPE,
			requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
			subject_token: 'github.jwt',
			subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
		});
		expect(calls[1]).toEqual({
			url: IMPERSONATE,
			auth: 'Bearer federated',
			body: JSON.stringify({
				scope: [CLOUD_PLATFORM_SCOPE, ANDROID_PUBLISHER_SCOPE],
				lifetime: '3600s',
			}),
		});
	});

	it('reads a subject token kept in a file', async () => {
		const subject = join(dir, 'subject');
		writeFileSync(subject, 'github.jwt\n');

		const token = await credentialsFileToken(githubActionsFile(subject), [
			CLOUD_PLATFORM_SCOPE,
		]);

		expect(token).toBe('ya29.deploy');
	});

	it('names the step that refused', async () => {
		const subject = join(dir, 'subject');
		writeFileSync(subject, 'someone-else.jwt');

		const refused = credentialsFileToken(githubActionsFile(subject), [
			CLOUD_PLATFORM_SCOPE,
		]);

		await expect(refused).rejects.toBeInstanceOf(GoogleTokenExchangeFailed);
		await expect(refused).rejects.toMatchObject({
			step: 'sts',
			status: 400,
			detail: 'The given credential is rejected',
		});
	});

	it('is what googleSignIn uses when the variable is set', async () => {
		const signIn = googleSignIn({
			GOOGLE_APPLICATION_CREDENTIALS: githubActionsFile(),
		});

		expect(await signIn.token({ interactive: false })).toBe('ya29.deploy');
	});
});

describe('a service account key', () => {
	it('signs a JWT for the scopes and exchanges it', async () => {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', {
			modulusLength: 2048,
		});
		let assertion = '';
		server.use(
			http.post('https://oauth2.googleapis.com/token', async ({ request }) => {
				assertion = new URLSearchParams(await request.text()).get('assertion')!;
				return HttpResponse.json({ access_token: 'ya29.key' });
			}),
		);
		const path = file('key.json', {
			type: 'service_account',
			client_email: ACCOUNT,
			private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
		});

		const token = await credentialsFileToken(path, [CLOUD_PLATFORM_SCOPE]);

		expect(token).toBe('ya29.key');
		const [header, claims, signature] = assertion.split('.');
		const verified = createVerify('RSA-SHA256')
			.update(`${header}.${claims}`)
			.verify(publicKey, signature!, 'base64url');
		expect(verified).toBe(true);
		expect(
			JSON.parse(Buffer.from(claims!, 'base64url').toString()),
		).toMatchObject({ iss: ACCOUNT, scope: CLOUD_PLATFORM_SCOPE });
	});
});

describe('a file gkm cannot use', () => {
	it('says when it is not credentials at all', async () => {
		const path = join(dir, 'nope.json');
		writeFileSync(path, 'not json');

		await expect(
			credentialsFileToken(path, [CLOUD_PLATFORM_SCOPE]),
		).rejects.toBeInstanceOf(GoogleCredentialsFileUnreadable);
	});

	it('names a type it does not read', async () => {
		const path = file('gdch.json', { type: 'gdch_service_account' });

		await expect(
			credentialsFileToken(path, [CLOUD_PLATFORM_SCOPE]),
		).rejects.toBeInstanceOf(GoogleCredentialsTypeUnsupported);
	});

	it('says when the file is not there', async () => {
		await expect(
			credentialsFileToken(join(dir, 'missing.json'), [CLOUD_PLATFORM_SCOPE]),
		).rejects.toBeInstanceOf(GoogleCredentialsFileUnreadable);
	});

	it('names a file with no type', async () => {
		await expect(
			credentialsFileToken(file('untyped.json', {}), [CLOUD_PLATFORM_SCOPE]),
		).rejects.toMatchObject({ type: '(none)' });
	});
});

describe('federation without a service account to act as', () => {
	it('asks STS for the scopes and uses its token directly', async () => {
		const subject = join(dir, 'subject');
		writeFileSync(subject, 'github.jwt');
		const path = file('direct.json', {
			type: 'external_account',
			audience: AUDIENCE,
			subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
			token_url: STS,
			credential_source: { file: subject },
		});

		const token = await credentialsFileToken(path, [
			CLOUD_PLATFORM_SCOPE,
			ANDROID_PUBLISHER_SCOPE,
		]);

		expect({
			token,
			scope: new URLSearchParams(calls[0]!.body).get('scope'),
			calls: calls.length,
		}).toEqual({
			token: 'federated',
			scope: `${CLOUD_PLATFORM_SCOPE} ${ANDROID_PUBLISHER_SCOPE}`,
			calls: 1,
		});
	});

	it('reads a plain-text subject token from a url', async () => {
		server.use(
			http.get('https://tokens.example.com/subject', () =>
				HttpResponse.text('github.jwt\n'),
			),
		);
		const path = file('text.json', {
			type: 'external_account',
			audience: AUDIENCE,
			subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
			token_url: STS,
			credential_source: { url: 'https://tokens.example.com/subject' },
		});

		expect(await credentialsFileToken(path, [CLOUD_PLATFORM_SCOPE])).toBe(
			'federated',
		);
	});
});

describe('a token that cannot be had', () => {
	function external(credential_source: Record<string, unknown>): string {
		return file('broken.json', {
			type: 'external_account',
			audience: AUDIENCE,
			subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
			token_url: STS,
			service_account_impersonation_url: IMPERSONATE,
			credential_source,
		});
	}

	it('names the subject token step when GitHub refuses', async () => {
		const refused = credentialsFileToken(
			external({
				url: GITHUB_TOKEN_URL,
				headers: { Authorization: 'Bearer stale' },
			}),
			[CLOUD_PLATFORM_SCOPE],
		);

		await expect(refused).rejects.toMatchObject({
			name: 'GoogleTokenExchangeFailed',
			step: 'subject token',
			status: 401,
		});
	});

	it('says when the source names neither a file nor a url', async () => {
		await expect(
			credentialsFileToken(external({}), [CLOUD_PLATFORM_SCOPE]),
		).rejects.toMatchObject({ step: 'subject token', status: 0 });
	});

	it('names the impersonation step, and says what to check', async () => {
		server.use(
			http.post(IMPERSONATE, () =>
				HttpResponse.json(
					{
						error: {
							message: 'Permission iam.serviceAccounts.getAccessToken denied',
						},
					},
					{ status: 403 },
				),
			),
		);
		const subject = join(dir, 'subject');
		writeFileSync(subject, 'github.jwt');

		const refused = credentialsFileToken(external({ file: subject }), [
			CLOUD_PLATFORM_SCOPE,
		]);

		await expect(refused).rejects.toMatchObject({
			step: 'impersonation',
			status: 403,
			detail: 'Permission iam.serviceAccounts.getAccessToken denied',
			message: expect.stringContaining('gkm deploy:github'),
		});
	});
});

describe("a person's application-default credential", () => {
	function adc(refreshToken: string): string {
		return file('adc.json', {
			type: 'authorized_user',
			client_id: 'client',
			client_secret: 'secret',
			refresh_token: refreshToken,
		});
	}

	it('exchanges its refresh token', async () => {
		let grant: Record<string, string> = {};
		server.use(
			http.post('https://oauth2.googleapis.com/token', async ({ request }) => {
				grant = Object.fromEntries(new URLSearchParams(await request.text()));
				return HttpResponse.json({ access_token: 'ya29.person' });
			}),
		);

		const token = await credentialsFileToken(adc('refresh'), [
			CLOUD_PLATFORM_SCOPE,
		]);

		expect({ token, grant }).toEqual({
			token: 'ya29.person',
			grant: {
				grant_type: 'refresh_token',
				client_id: 'client',
				client_secret: 'secret',
				refresh_token: 'refresh',
			},
		});
	});

	it('names the oauth step when the refresh token is revoked', async () => {
		server.use(
			http.post('https://oauth2.googleapis.com/token', () =>
				HttpResponse.json(
					{
						error: 'invalid_grant',
						error_description: 'Token has been expired or revoked.',
					},
					{ status: 400 },
				),
			),
		);

		await expect(
			credentialsFileToken(adc('revoked'), [CLOUD_PLATFORM_SCOPE]),
		).rejects.toMatchObject({
			step: 'oauth',
			status: 400,
			detail: 'Token has been expired or revoked.',
		});
	});
});
