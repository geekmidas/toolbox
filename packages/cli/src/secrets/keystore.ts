import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Key length for AES-256 encryption */
const KEY_LENGTH = 32; // 256 bits

/**
 * Get the keystore directory for a project.
 * Keys are stored at ~/.gkm/{project-name}/
 *
 * @param projectName - Name of the project (defaults to current directory name)
 * @returns Path to the keystore directory
 */
export function getKeystoreDir(projectName?: string): string {
	const name = projectName ?? basename(process.cwd());
	return join(homedir(), '.gkm', name);
}

/**
 * Get the path to a stage's encryption key.
 *
 * @param stage - Stage name (e.g., 'development', 'production')
 * @param projectName - Name of the project (defaults to current directory name)
 * @returns Path to the key file
 */
export function getKeyPath(stage: string, projectName?: string): string {
	return join(getKeystoreDir(projectName), `${stage}.key`);
}

/**
 * Check if a key exists for a stage.
 */
export function keyExists(stage: string, projectName?: string): boolean {
	return existsSync(getKeyPath(stage, projectName));
}

/**
 * Generate a new encryption key for a stage.
 * The key is stored at ~/.gkm/{project-name}/{stage}.key with restricted permissions.
 *
 * @param stage - Stage name
 * @param projectName - Project name (defaults to current directory name)
 * @returns The generated key as a hex string
 */
export async function generateKey(
	stage: string,
	projectName?: string,
): Promise<string> {
	const keyDir = getKeystoreDir(projectName);
	const keyPath = getKeyPath(stage, projectName);

	// Ensure keystore directory exists with restricted permissions
	await mkdir(keyDir, { recursive: true, mode: 0o700 });

	// Generate random key
	const key = randomBytes(KEY_LENGTH).toString('hex');

	// Write key with restricted permissions (owner read/write only)
	await writeFile(keyPath, key, { mode: 0o600, encoding: 'utf-8' });

	// Ensure permissions are set correctly (in case file existed)
	await chmod(keyPath, 0o600);

	return key;
}

/**
 * Read an encryption key for a stage.
 *
 * @param stage - Stage name
 * @param projectName - Project name (defaults to current directory name)
 * @returns The key as a hex string, or null if not found
 */
export async function readKey(
	stage: string,
	projectName?: string,
): Promise<string | null> {
	const keyPath = getKeyPath(stage, projectName);

	if (!existsSync(keyPath)) {
		return null;
	}

	const key = await readFile(keyPath, 'utf-8');
	return key.trim();
}

/**
 * Read an encryption key for a stage, throwing if not found.
 */
export async function requireKey(
	stage: string,
	projectName?: string,
): Promise<string> {
	const key = await readKey(stage, projectName);

	if (!key) {
		const name = projectName ?? basename(process.cwd());
		throw new Error(
			`Encryption key not found for stage "${stage}" in project "${name}". ` +
				`Expected key at: ${getKeyPath(stage, projectName)}`,
		);
	}

	return key;
}

/**
 * Delete a key for a stage.
 */
export async function deleteKey(
	stage: string,
	projectName?: string,
): Promise<void> {
	const keyPath = getKeyPath(stage, projectName);

	if (existsSync(keyPath)) {
		await rm(keyPath);
	}
}

/**
 * Get or create a key for a stage.
 * If the key already exists, it is returned. Otherwise, a new key is generated.
 *
 * @param stage - Stage name
 * @param projectName - Project name (defaults to current directory name)
 * @returns The key as a hex string
 */
export async function getOrCreateKey(
	stage: string,
	projectName?: string,
): Promise<string> {
	const existingKey = await readKey(stage, projectName);

	if (existingKey) {
		return existingKey;
	}

	return generateKey(stage, projectName);
}
