import { existsSync, mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gkmHome } from '../home';

/**
 * Stored credentials for various services
 */
export interface StoredCredentials {
	dokploy?: {
		/** API token */
		token: string;
		/** Dokploy endpoint URL */
		endpoint: string;
		/** Registry ID in Dokploy (for Docker image pulls) */
		registryId?: string;
		/** When the credentials were stored */
		storedAt: string;
	};
	hostinger?: {
		/** API token from hpanel.hostinger.com/profile/api */
		token: string;
		/** When the credentials were stored */
		storedAt: string;
	};
	godaddy?: {
		/** A Personal Access Token, scoped to domains.dns:update */
		token: string;
		/** When the credentials were stored */
		storedAt: string;
	};
}

/**
 * Options for credential operations
 */
export interface CredentialOptions {
	/**
	 * A directory whose `.gkm` holds the credentials. Default: the CLI's home
	 * (`GKM_HOME`, else `~/.gkm`).
	 */
	root?: string;
	/** The CLI's home itself, holding `credentials.json`. Wins over `root`. */
	home?: string;
}

/**
 * Get the path to the credentials directory
 */
export function getCredentialsDir(options?: CredentialOptions): string {
	if (options?.home) return options.home;
	return options?.root ? join(options.root, '.gkm') : gkmHome();
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
	registryId?: string;
} | null> {
	const credentials = await readCredentials(options);

	// The environment first, and each half independently.
	//
	// `getDokployToken` has always read `DOKPLOY_API_TOKEN` while this — the
	// function the deploy path actually calls — read only the file. So a CI job
	// given the token as a secret had a token and nowhere to send it, and the
	// only way through was committing a credentials file or running an
	// interactive login on the runner.
	//
	// Read separately rather than as a pair because they arrive separately: a
	// token is a secret and belongs in the environment, while an endpoint is
	// configuration and usually belongs in `deploy.dokploy.endpoint`. Requiring
	// both from the same place is what made either one useless alone.
	const token = process.env.DOKPLOY_API_TOKEN ?? credentials.dokploy?.token;
	const endpoint =
		process.env.DOKPLOY_ENDPOINT ?? credentials.dokploy?.endpoint;

	if (!token || !endpoint) return null;

	return {
		token,
		endpoint: endpoint.replace(/\/$/, ''),
		...(credentials.dokploy?.registryId
			? { registryId: credentials.dokploy.registryId }
			: {}),
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

/**
 * Store Dokploy registry ID
 */
export async function storeDokployRegistryId(
	registryId: string,
	options?: CredentialOptions,
): Promise<void> {
	const credentials = await readCredentials(options);

	if (!credentials.dokploy) {
		throw new Error(
			'Dokploy credentials not found. Run "gkm login --service dokploy" first.',
		);
	}

	credentials.dokploy.registryId = registryId;
	await writeCredentials(credentials, options);
}

/**
 * Get Dokploy registry ID from stored credentials
 */
export async function getDokployRegistryId(
	options?: CredentialOptions,
): Promise<string | undefined> {
	const stored = await getDokployCredentials(options);
	return stored?.registryId ?? undefined;
}

// ============================================
// Hostinger credentials
// ============================================

/**
 * Store Hostinger API token
 *
 * @param token - API token from hpanel.hostinger.com/profile/api
 */
export async function storeHostingerToken(
	token: string,
	options?: CredentialOptions,
): Promise<void> {
	const credentials = await readCredentials(options);

	credentials.hostinger = {
		token,
		storedAt: new Date().toISOString(),
	};

	await writeCredentials(credentials, options);
}

/**
 * Get stored Hostinger API token
 *
 * Checks environment variable first (HOSTINGER_API_TOKEN),
 * then falls back to stored credentials.
 */
export async function getHostingerToken(
	options?: CredentialOptions,
): Promise<string | null> {
	// First check environment variable (takes precedence)
	const envToken = process.env.HOSTINGER_API_TOKEN;
	if (envToken) {
		return envToken;
	}

	// Then check stored credentials
	const credentials = await readCredentials(options);
	return credentials.hostinger?.token ?? null;
}

/**
 * Remove Hostinger credentials
 */
export async function removeHostingerCredentials(
	options?: CredentialOptions,
): Promise<boolean> {
	const credentials = await readCredentials(options);

	if (!credentials.hostinger) {
		return false;
	}

	delete credentials.hostinger;
	await writeCredentials(credentials, options);
	return true;
}

// ============================================
// GoDaddy credentials
// ============================================

/**
 * Store a GoDaddy Personal Access Token.
 */
export async function storeGoDaddyToken(
	token: string,
	options?: CredentialOptions,
): Promise<void> {
	const credentials = await readCredentials(options);

	credentials.godaddy = {
		token,
		storedAt: new Date().toISOString(),
	};

	await writeCredentials(credentials, options);
}

/**
 * Remove GoDaddy credentials
 */
export async function removeGoDaddyCredentials(
	options?: CredentialOptions,
): Promise<boolean> {
	const credentials = await readCredentials(options);

	if (!credentials.godaddy) {
		return false;
	}

	delete credentials.godaddy;
	await writeCredentials(credentials, options);
	return true;
}
