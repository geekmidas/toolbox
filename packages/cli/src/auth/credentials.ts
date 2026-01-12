import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
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
 * Get the path to the credentials directory
 */
export function getCredentialsDir(): string {
	return join(homedir(), '.gkm');
}

/**
 * Get the path to the credentials file
 */
export function getCredentialsPath(): string {
	return join(getCredentialsDir(), 'credentials.json');
}

/**
 * Ensure the credentials directory exists
 */
function ensureCredentialsDir(): void {
	const dir = getCredentialsDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
}

/**
 * Read stored credentials from disk
 */
export async function readCredentials(): Promise<StoredCredentials> {
	const path = getCredentialsPath();

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
): Promise<void> {
	ensureCredentialsDir();
	const path = getCredentialsPath();

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
): Promise<void> {
	const credentials = await readCredentials();

	credentials.dokploy = {
		token,
		endpoint,
		storedAt: new Date().toISOString(),
	};

	await writeCredentials(credentials);
}

/**
 * Get stored Dokploy credentials
 */
export async function getDokployCredentials(): Promise<{
	token: string;
	endpoint: string;
} | null> {
	const credentials = await readCredentials();

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
export async function removeDokployCredentials(): Promise<boolean> {
	const credentials = await readCredentials();

	if (!credentials.dokploy) {
		return false;
	}

	delete credentials.dokploy;
	await writeCredentials(credentials);
	return true;
}

/**
 * Remove all stored credentials
 */
export async function removeAllCredentials(): Promise<void> {
	const path = getCredentialsPath();

	if (existsSync(path)) {
		await unlink(path);
	}
}

/**
 * Get Dokploy API token, checking stored credentials first, then environment
 */
export async function getDokployToken(): Promise<string | null> {
	// First check environment variable (takes precedence)
	const envToken = process.env.DOKPLOY_API_TOKEN;
	if (envToken) {
		return envToken;
	}

	// Then check stored credentials
	const stored = await getDokployCredentials();
	if (stored) {
		return stored.token;
	}

	return null;
}

/**
 * Get Dokploy endpoint from stored credentials
 */
export async function getDokployEndpoint(): Promise<string | null> {
	const stored = await getDokployCredentials();
	return stored?.endpoint ?? null;
}
