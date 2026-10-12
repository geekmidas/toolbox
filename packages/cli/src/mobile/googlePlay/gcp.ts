/**
 * The Google Cloud side of publishing to Play: a project with the Android
 * Publisher API on, and a service account in it whose JSON key EAS Submit
 * uses. Each step finds what is there before it creates anything, so a
 * second run reuses the project and the account and only makes a new key.
 */

import { GkmError } from '../../errors';
import { finished, GoogleApiError, type GoogleClient } from './google.js';

export const CLOUD_RESOURCE_MANAGER =
	'https://cloudresourcemanager.googleapis.com/v3';
export const SERVICE_USAGE = 'https://serviceusage.googleapis.com/v1';
export const IAM = 'https://iam.googleapis.com/v1';

/** The API EAS Submit and gkm call Play through. */
export const ANDROID_PUBLISHER_API = 'androidpublisher.googleapis.com';

/** A project id or service account id gkm would derive is not a valid one. */
export class GoogleIdInvalid extends GkmError {
	constructor(
		readonly kind: 'project' | 'service account',
		readonly id: string,
	) {
		super(
			`'${id}' is not a valid Google ${kind} id: 6 to 30 lowercase letters, ` +
				'digits and hyphens, starting with a letter and not ending in a hyphen. ' +
				(kind === 'project' ? 'Name one with --project.' : ''),
		);
		this.name = 'GoogleIdInvalid';
	}
}

/** The project could not be created — most often, its id is someone else's. */
export class GoogleProjectUnavailable extends GkmError {
	constructor(
		readonly project: string,
		readonly detail: string,
	) {
		super(
			`Could not create the Google Cloud project '${project}' (${detail}). ` +
				'Project ids are global: name another, or one you already have, with --project.',
		);
		this.name = 'GoogleProjectUnavailable';
	}
}

const ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * An id Google accepts, from a workspace's name: `shop` → `shop-play`.
 * Lowercased, anything else made a hyphen, cut to 30.
 */
export function playId(workspace: string): string {
	const base = workspace
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^[^a-z]+|-+$/g, '');
	return `${base.slice(0, 25).replace(/-+$/, '')}-play`;
}

/** Throws unless `id` is a valid project or service account id. */
export function assertGoogleId(
	kind: 'project' | 'service account',
	id: string,
): void {
	if (!ID.test(id)) throw new GoogleIdInvalid(kind, id);
}

/**
 * The project, created when it is not there. Answers whether it was made.
 *
 * @throws {GoogleProjectUnavailable}
 */
export async function ensureProject(
	client: GoogleClient,
	project: string,
	displayName: string,
	options: { intervalMs?: number } = {},
): Promise<boolean> {
	assertGoogleId('project', project);
	try {
		await client.request(
			'GET',
			`${CLOUD_RESOURCE_MANAGER}/projects/${project}`,
		);
		return false;
	} catch (error) {
		// Absent, or not ours to see — either way, try to create it.
		if (
			!(error instanceof GoogleApiError) ||
			![403, 404].includes(error.status)
		) {
			throw error;
		}
	}
	try {
		const operation = await client.request<{ name?: string; done?: boolean }>(
			'POST',
			`${CLOUD_RESOURCE_MANAGER}/projects`,
			{ projectId: project, displayName: displayName.slice(0, 30) },
		);
		await finished(client, CLOUD_RESOURCE_MANAGER, operation, options);
	} catch (error) {
		if (error instanceof GoogleApiError) {
			throw new GoogleProjectUnavailable(project, error.detail);
		}
		throw error;
	}
	return true;
}

/** The Android Publisher API, on in the project. */
export async function enablePublisherApi(
	client: GoogleClient,
	project: string,
	options: { intervalMs?: number } = {},
): Promise<void> {
	const operation = await client.request<{ name?: string; done?: boolean }>(
		'POST',
		`${SERVICE_USAGE}/projects/${project}/services/${ANDROID_PUBLISHER_API}:enable`,
		{},
	);
	await finished(client, SERVICE_USAGE, operation, options);
}

/** The service account's email, which is what Play and EAS know it by. */
export function serviceAccountEmail(project: string, account: string): string {
	return `${account}@${project}.iam.gserviceaccount.com`;
}

/** The service account, created when it is not there. Answers its email. */
export async function ensureServiceAccount(
	client: GoogleClient,
	project: string,
	account: string,
	displayName: string,
): Promise<string> {
	assertGoogleId('service account', account);
	const email = serviceAccountEmail(project, account);
	try {
		await client.request(
			'GET',
			`${IAM}/projects/${project}/serviceAccounts/${email}`,
		);
		return email;
	} catch (error) {
		if (!(error instanceof GoogleApiError) || error.status !== 404) throw error;
	}
	await client.request('POST', `${IAM}/projects/${project}/serviceAccounts`, {
		accountId: account,
		serviceAccount: { displayName: displayName.slice(0, 100) },
	});
	return email;
}

/** A service account key: its id, and — only when just made — its JSON. */
export interface ServiceAccountKey {
	/** `projects/<p>/serviceAccounts/<email>/keys/<id>`. */
	name: string;
	/** The key file's JSON, held in memory and never written anywhere. */
	json?: string;
}

/** A new key for the account. Its JSON exists only in what this returns. */
export async function createKey(
	client: GoogleClient,
	project: string,
	email: string,
): Promise<ServiceAccountKey & { json: string }> {
	const key = await client.request<{ name: string; privateKeyData: string }>(
		'POST',
		`${IAM}/projects/${project}/serviceAccounts/${email}/keys`,
		{},
	);
	return {
		name: key.name,
		json: Buffer.from(key.privateKeyData, 'base64').toString('utf8'),
	};
}

/** The account's keys that someone made — not Google's own. */
export async function listKeys(
	client: GoogleClient,
	project: string,
	email: string,
): Promise<ServiceAccountKey[]> {
	const { keys = [] } = await client.request<{ keys?: { name: string }[] }>(
		'GET',
		`${IAM}/projects/${project}/serviceAccounts/${email}/keys?keyTypes=USER_MANAGED`,
	);
	return keys.map(({ name }) => ({ name }));
}

export async function deleteKey(
	client: GoogleClient,
	key: ServiceAccountKey,
): Promise<void> {
	await client.request('DELETE', `${IAM}/${key.name}`);
}

/** A key's id: the last part of its name. */
export function keyId(key: Pick<ServiceAccountKey, 'name'>): string {
	return key.name.split('/').pop()!;
}
