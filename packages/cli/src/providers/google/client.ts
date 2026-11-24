/**
 * Calling Google's REST APIs with an access token: one client per token and
 * quota project, its errors, and long-running operations polled to the end.
 *
 * A user credential (gcloud's) needs the project named as its quota project
 * (`x-goog-user-project`) for APIs that bill the caller's project — the Play
 * Developer API, the API Keys API — so a client is made for one project.
 */

import { GkmError } from '../../errors';

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
				throw new GoogleApiError(
					method,
					url,
					response.status,
					errorDetail(text),
				);
			}
			return (text ? JSON.parse(text) : {}) as never;
		},
	};
}

/** Google's `{ error: { message } }`, or the body itself. */
export function errorDetail(text: string): string {
	try {
		const parsed = JSON.parse(text) as {
			error?: { message?: string } | string;
			error_description?: string;
		};
		if (typeof parsed.error === 'object' && parsed.error?.message) {
			return parsed.error.message;
		}
		if (parsed.error_description) return parsed.error_description;
		if (typeof parsed.error === 'string') return parsed.error;
	} catch {
		// Not JSON: the text is the detail.
	}
	return text;
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
