import { existsSync, mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Stored credentials for various services
 */
export interface StoredCredentials {
	dokploy?: {
		/** API token */
		token: string;
		/** Dokploy endpoint URL */
		endpoint: string;
		/** When the credentials were stored */
		storedAt: string;
	};
}

/**
 * Options for credential operations
 */
export interface CredentialOptions {
	/** Root directory for credentials storage (default: user home directory) */
	root?: string;
}

/**
 * Get the path to the credentials directory
 */
export function getCredentialsDir(options?: CredentialOptions): string {
	const root = options?.root ?? homedir();
	return join(root, '.gkm');
}

/**
 * Get the path to the credentials file
 */
export function getCredentialsPath(options?: CredentialOptions): string {
	return join(getCredentialsDir(options), 'credentials.json');
}

/**
 * Ensure the credentials directory exists
 */
function ensureCredentialsDir(options?: CredentialOptions): void {
	const dir = getCredentialsDir(options);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
}

/**
 * Read stored credentials from disk
 */
export async function readCredentials(
	options?: CredentialOptions,
): Promise<StoredCredentials> {
	const path = getCredentialsPath(options);

	if (!existsSync(path)) {
		return {};
	}

	try {
		const content = await readFile(path, 'utf-8');
		return JSON.parse(content) as StoredCredentials;
	} catch {
		return {};
	}
}

/**
 * Write credentials to disk
 */
export async function writeCredentials(
	credentials: StoredCredentials,
	options?: CredentialOptions,
): Promise<void> {
	ensureCredentialsDir(options);
	const path = getCredentialsPath(options);

	await writeFile(path, JSON.stringify(credentials, null, 2), {
		mode: 0o600, // Owner read/write only
	});
}

/**
 * Store Dokploy credentials
 */
export async function storeDokployCredentials(
	token: string,
	endpoint: string,
	options?: CredentialOptions,
): Promise<void> {
	const credentials = await readCredentials(options);

	credentials.dokploy = {
		token,
		endpoint,
		storedAt: new Date().toISOString(),
	};

	await writeCredentials(credentials, options);
}

/**
 * Get stored Dokploy credentials
 */
export async function getDokployCredentials(
	options?: CredentialOptions,
): Promise<{
	token: string;
	endpoint: string;
} | null> {
	const credentials = await readCredentials(options);

	if (!credentials.dokploy) {
		return null;
	}

	return {
		token: credentials.dokploy.token,
		endpoint: credentials.dokploy.endpoint,
	};
}

/**
 * Remove Dokploy credentials
 */
export async function removeDokployCredentials(
	options?: CredentialOptions,
): Promise<boolean> {
	const credentials = await readCredentials(options);

	if (!credentials.dokploy) {
		return false;
	}

	delete credentials.dokploy;
	await writeCredentials(credentials, options);
	return true;
}

/**
 * Remove all stored credentials
 */
export async function removeAllCredentials(
	options?: CredentialOptions,
): Promise<void> {
	const path = getCredentialsPath(options);

	if (existsSync(path)) {
		await unlink(path);
	}
}

/**
 * Get Dokploy API token, checking stored credentials first, then environment
 */
export async function getDokployToken(
	options?: CredentialOptions,
): Promise<string | null> {
	// First check environment variable (takes precedence)
	const envToken = process.env.DOKPLOY_API_TOKEN;
	if (envToken) {
		return envToken;
	}

	// Then check stored credentials
	const stored = await getDokployCredentials(options);
	if (stored) {
		return stored.token;
	}

	return null;
}

/**
 * Get Dokploy endpoint from stored credentials
 */
export async function getDokployEndpoint(
	options?: CredentialOptions,
): Promise<string | null> {
	const stored = await getDokployCredentials(options);
	return stored?.endpoint ?? null;
}
