/**
 * A token from the file `GOOGLE_APPLICATION_CREDENTIALS` names — how a run
 * with no person at it reaches Google.
 *
 * In GitHub Actions, `google-github-actions/auth` writes an
 * `external_account` file: the job's OIDC token, where to fetch it, and the
 * Workload Identity provider it is exchanged at (STS), then — with a service
 * account to act as — that account's token, made by IAM Credentials. Both
 * are plain HTTPS calls, made here without gcloud or Google's client
 * library.
 *
 * A `service_account` key (signed JWT, exchanged) and an `authorized_user`
 * file (a refresh token) are read too, as Google's own libraries read them.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GkmError } from '../../errors';
import { errorDetail } from './client.js';
import { CLOUD_PLATFORM_SCOPE } from './gcloud.js';

/** The file could not be read as Google credentials. */
export class GoogleCredentialsFileUnreadable extends GkmError {
	constructor(
		readonly path: string,
		readonly detail: string,
	) {
		super(
			`GOOGLE_APPLICATION_CREDENTIALS names ${path}, and it could not be read ` +
				`as Google credentials (${detail}). Point it at the file ` +
				'google-github-actions/auth wrote, or unset it to sign in with gcloud.',
		);
		this.name = 'GoogleCredentialsFileUnreadable';
	}
}

/** A credentials file of a type gkm does not read. */
export class GoogleCredentialsTypeUnsupported extends GkmError {
	constructor(
		readonly path: string,
		readonly type: string,
	) {
		super(
			`${path} holds '${type}' credentials; gkm reads external_account ` +
				'(Workload Identity Federation), service_account and authorized_user.',
		);
		this.name = 'GoogleCredentialsTypeUnsupported';
	}
}

/** One step of turning the file into a token was refused. */
export class GoogleTokenExchangeFailed extends GkmError {
	constructor(
		readonly step: 'subject token' | 'sts' | 'impersonation' | 'oauth',
		readonly status: number,
		readonly detail: string,
	) {
		super(
			`Getting a Google token failed at the ${step} step (${status}): ${detail}. ` +
				(step === 'sts' || step === 'impersonation'
					? "Check the Workload Identity provider's attribute condition and the " +
						'service account binding match this repository and environment — ' +
						'gkm deploy:github sets both up.'
					: ''),
		);
		this.name = 'GoogleTokenExchangeFailed';
	}
}

/** `external_account`, as google-github-actions/auth writes it. */
export interface ExternalAccountJson {
	type: 'external_account';
	/** `//iam.googleapis.com/projects/<n>/locations/global/workloadIdentityPools/<pool>/providers/<p>`. */
	audience: string;
	subject_token_type: string;
	token_url: string;
	/** `…/serviceAccounts/<email>:generateAccessToken`, to act as an account. */
	service_account_impersonation_url?: string;
	credential_source: {
		/** A file holding the subject token. */
		file?: string;
		/** Where to GET the subject token. */
		url?: string;
		headers?: Record<string, string>;
		format?: { type?: 'text' | 'json'; subject_token_field_name?: string };
	};
}

/** A service account key file. */
export interface ServiceAccountJson {
	type?: 'service_account';
	client_email: string;
	private_key: string;
	token_uri?: string;
}

/** `gcloud auth application-default login`'s file, used elsewhere. */
export interface AuthorizedUserJson {
	type: 'authorized_user';
	client_id: string;
	client_secret: string;
	refresh_token: string;
}

const TOKEN_URI = 'https://oauth2.googleapis.com/token';

async function post(
	step: GoogleTokenExchangeFailed['step'],
	url: string,
	init: { headers: Record<string, string>; body: string },
): Promise<Record<string, unknown>> {
	const response = await fetch(url, { method: 'POST', ...init });
	const text = await response.text();
	if (!response.ok) {
		throw new GoogleTokenExchangeFailed(
			step,
			response.status,
			errorDetail(text),
		);
	}
	return JSON.parse(text) as Record<string, unknown>;
}

function form(values: Record<string, string>) {
	return {
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(values).toString(),
	};
}

async function subjectToken(
	source: ExternalAccountJson['credential_source'],
): Promise<string> {
	let raw: string;
	if (source.file) {
		raw = readFileSync(source.file, 'utf8');
	} else if (source.url) {
		const response = await fetch(source.url, { headers: source.headers });
		raw = await response.text();
		if (!response.ok) {
			throw new GoogleTokenExchangeFailed(
				'subject token',
				response.status,
				errorDetail(raw),
			);
		}
	} else {
		throw new GoogleTokenExchangeFailed(
			'subject token',
			0,
			'credential_source names neither a file nor a url',
		);
	}
	if (source.format?.type === 'json') {
		const field = source.format.subject_token_field_name ?? 'value';
		return String((JSON.parse(raw) as Record<string, unknown>)[field] ?? '');
	}
	return raw.trim();
}

/** Workload Identity Federation: the subject token, exchanged, impersonated. */
export async function externalAccountToken(
	account: ExternalAccountJson,
	scopes: readonly string[],
): Promise<string> {
	const impersonate = account.service_account_impersonation_url;
	const sts = await post(
		'sts',
		account.token_url,
		form({
			grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
			audience: account.audience,
			// Impersonating, the federated token only needs to call IAM
			// Credentials; the account's token carries the scopes.
			scope: impersonate ? CLOUD_PLATFORM_SCOPE : scopes.join(' '),
			requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
			subject_token: await subjectToken(account.credential_source),
			subject_token_type: account.subject_token_type,
		}),
	);
	const federated = String(sts.access_token ?? '');
	if (!impersonate) return federated;
	const impersonated = await post('impersonation', impersonate, {
		headers: {
			authorization: `Bearer ${federated}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ scope: scopes, lifetime: '3600s' }),
	});
	return String(impersonated.accessToken ?? '');
}

/** A service account key: a signed JWT, exchanged for a token. */
export async function serviceAccountToken(
	key: ServiceAccountJson,
	scopes: readonly string[],
): Promise<string> {
	const tokenUri = key.token_uri ?? TOKEN_URI;
	const now = Math.floor(Date.now() / 1000);
	const encode = (value: object) =>
		Buffer.from(JSON.stringify(value)).toString('base64url');
	const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
		iss: key.client_email,
		scope: scopes.join(' '),
		aud: tokenUri,
		iat: now,
		exp: now + 600,
	})}`;
	const signature = createSign('RSA-SHA256')
		.update(unsigned)
		.sign(key.private_key)
		.toString('base64url');
	const body = await post(
		'oauth',
		tokenUri,
		form({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${unsigned}.${signature}`,
		}),
	);
	return String(body.access_token ?? '');
}

async function authorizedUserToken(user: AuthorizedUserJson): Promise<string> {
	const body = await post(
		'oauth',
		TOKEN_URI,
		form({
			grant_type: 'refresh_token',
			client_id: user.client_id,
			client_secret: user.client_secret,
			refresh_token: user.refresh_token,
		}),
	);
	return String(body.access_token ?? '');
}

/**
 * A token from the credentials file at `path`, carrying `scopes`.
 *
 * @throws {GoogleCredentialsFileUnreadable}, {GoogleCredentialsTypeUnsupported},
 *   {GoogleTokenExchangeFailed}
 */
export async function credentialsFileToken(
	path: string,
	scopes: readonly string[],
): Promise<string> {
	let parsed: { type?: string };
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8')) as { type?: string };
	} catch (error) {
		throw new GoogleCredentialsFileUnreadable(
			path,
			error instanceof Error ? error.message : String(error),
		);
	}
	switch (parsed.type) {
		case 'external_account':
			return externalAccountToken(parsed as ExternalAccountJson, scopes);
		case 'service_account':
			return serviceAccountToken(parsed as ServiceAccountJson, scopes);
		case 'authorized_user':
			return authorizedUserToken(parsed as AuthorizedUserJson);
		default:
			throw new GoogleCredentialsTypeUnsupported(path, parsed.type ?? '(none)');
	}
}
