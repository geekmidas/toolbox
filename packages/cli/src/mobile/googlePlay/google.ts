/**
 * Google, as `gkm deploy:google-play` reaches it: a token for the person
 * running it, and the Cloud APIs that make a project, a service account and
 * its key.
 *
 * The token is gcloud's own application-default credential, with the
 * `cloud-platform` and `androidpublisher` scopes — no OAuth client of gkm's —
 * kept in gkm's own gcloud config (`<gkm home>/gcloud`), so the person's own
 * gcloud setup is never read or changed. Every call carries the project as
 * its quota project (`x-goog-user-project`), which the Play Developer API
 * requires of a user credential.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { GkmError } from '../../errors';
import { gkmHome } from '../../home.js';

/** The scopes the sign-in asks for. */
export const GOOGLE_SCOPES = [
	'https://www.googleapis.com/auth/cloud-platform',
	'https://www.googleapis.com/auth/androidpublisher',
];

/** `gcloud` is not installed. */
export class GcloudMissing extends GkmError {
	constructor() {
		super(
			'gkm signs in to Google with gcloud, and there is no `gcloud` here. ' +
				'Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install.',
		);
		this.name = 'GcloudMissing';
	}
}

/** Not signed in, and no terminal to sign in from. */
export class GoogleSignInRequired extends GkmError {
	constructor(readonly config: string) {
		super(
			'Signing in to Google opens a browser, and this run has no terminal. ' +
				'Run it once where you can sign in, as a Play Console admin: ' +
				`CLOUDSDK_CONFIG=${config} gcloud auth application-default login ` +
				`--scopes=${GOOGLE_SCOPES.join(',')}.`,
		);
		this.name = 'GoogleSignInRequired';
	}
}

/** A Google API refused a call. */
export class GoogleApiError extends GkmError {
	constructor(
		readonly method: string,
		readonly url: string,
		readonly status: number,
		readonly detail: string,
	) {
		super(`Google answered ${status} to ${method} ${url}: ${detail}`);
		this.name = 'GoogleApiError';
	}
}

/** A long-running Google operation did not finish in time. */
export class GoogleOperationTimedOut extends GkmError {
	constructor(readonly operation: string) {
		super(
			`Google's operation ${operation} had not finished after a minute. ` +
				'Run the command again: what it finished is kept.',
		);
		this.name = 'GoogleOperationTimedOut';
	}
}

/** Where gkm keeps its gcloud sign-in. */
export function gcloudConfig(env: NodeJS.ProcessEnv = process.env): string {
	return join(gkmHome(env), 'gcloud');
}

/** How a token is had: the real one runs gcloud. */
export interface GoogleSignIn {
	/** An access token for the signed-in person, signing in if allowed. */
	token(options: { interactive: boolean }): Promise<string>;
}

function gcloud(
	args: readonly string[],
	config: string,
	inherit: boolean,
): Promise<{ code: number | null; stdout: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn('gcloud', [...args], {
			stdio: [
				'inherit',
				inherit ? 'inherit' : 'pipe',
				inherit ? 'inherit' : 'pipe',
			],
			env: { ...process.env, CLOUDSDK_CONFIG: config },
		});
		let stdout = '';
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.on('error', (error: NodeJS.ErrnoException) =>
			reject(error.code === 'ENOENT' ? new GcloudMissing() : error),
		);
		child.on('close', (code) => resolve({ code, stdout }));
	});
}

/** gcloud's application-default credential, in gkm's own gcloud config. */
export function gcloudSignIn(config: string = gcloudConfig()): GoogleSignIn {
	return {
		async token({ interactive }) {
			const print = () =>
				gcloud(
					['auth', 'application-default', 'print-access-token'],
					config,
					false,
				);
			let printed = await print();
			if (printed.code !== 0) {
				if (!interactive) throw new GoogleSignInRequired(config);
				await gcloud(
					[
						'auth',
						'application-default',
						'login',
						`--scopes=${GOOGLE_SCOPES.join(',')}`,
					],
					config,
					true,
				);
				printed = await print();
				if (printed.code !== 0) throw new GoogleSignInRequired(config);
			}
			return printed.stdout.trim();
		},
	};
}

/** One authenticated Google API caller, for one quota project. */
export interface GoogleClient {
	request<T>(
		method: string,
		url: string,
		body?: unknown,
		options?: { raw?: { contentType: string; data: Uint8Array } },
	): Promise<T>;
}

export function googleClient(
	token: string,
	quotaProject?: string,
): GoogleClient {
	return {
		async request(method, url, body, options) {
			const headers: Record<string, string> = {
				authorization: `Bearer ${token}`,
				...(quotaProject ? { 'x-goog-user-project': quotaProject } : {}),
			};
			let payload: string | Uint8Array | undefined;
			if (options?.raw) {
				headers['content-type'] = options.raw.contentType;
				payload = options.raw.data;
			} else if (body !== undefined) {
				headers['content-type'] = 'application/json';
				payload = JSON.stringify(body);
			}
			const response = await fetch(url, {
				method,
				headers,
				...(payload !== undefined ? { body: payload } : {}),
			});
			const text = await response.text();
			if (!response.ok) {
				let detail = text;
				try {
					const parsed = JSON.parse(text) as { error?: { message?: string } };
					detail = parsed.error?.message ?? text;
				} catch {
					// Not JSON: the text is the detail.
				}
				throw new GoogleApiError(method, url, response.status, detail);
			}
			return (text ? JSON.parse(text) : {}) as never;
		},
	};
}

/** A long-running operation, polled until it is done. */
export async function finished(
	client: GoogleClient,
	base: string,
	operation: { name?: string; done?: boolean; error?: { message?: string } },
	options: { intervalMs?: number; attempts?: number } = {},
): Promise<void> {
	let current = operation;
	for (let attempt = 0; !current.done; attempt++) {
		if (attempt >= (options.attempts ?? 30)) {
			throw new GoogleOperationTimedOut(current.name ?? '(unnamed)');
		}
		await new Promise((resolve) =>
			setTimeout(resolve, options.intervalMs ?? 2_000),
		);
		current = await client.request('GET', `${base}/${current.name}`);
	}
	if (current.error) {
		throw new GoogleApiError(
			'GET',
			`${base}/${current.name}`,
			500,
			current.error.message ?? 'the operation failed',
		);
	}
}
