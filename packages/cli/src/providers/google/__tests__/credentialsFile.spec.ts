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
const GITHUB_TOKEN_URL =
	'https://pipelines.actions.githubusercontent.com/oidc?audience=x';

const server = setupServer();
let dir: string;
let calls: { url: string; body: string; auth: string | null }[];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
	dir = realpathSync(await createTempDir('gkm-google-creds-'));
	calls = [];
	server.use(
		http.get(GITHUB_TOKEN_URL, ({ request }) =>
			request.headers.get('authorization') === 'Bearer gh-request-token'
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
});
