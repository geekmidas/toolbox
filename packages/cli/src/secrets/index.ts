import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
	ConfigNotFound,
	loadWorkspaceConfig,
	loadWorkspaceSettings,
} from '../config';
import { constructGlobs } from '../reconcile/workspace';
import { generateFullstackCustomSecrets } from '../setup/fullstack-secrets';
import { CredentialsInvalid, loadCredentialSchemas } from './credentialSchemas';
import { FileSecretsStore } from './file.js';
import { createStageSecrets, rotateServicePassword } from './generator';
import { maskPassword, withCustomSecret } from './storage';
import { type SecretsStore, secretsStoreFor } from './store.js';
import type { SecretServiceName } from './types';

const logger = console;

/**
 * The store the stage named on the command line keeps its secrets in — SSM in
 * its account, for a deployed stage kept there. Outside any workspace nothing
 * names a store, so it is the file.
 */
async function storeFor(stage: string): Promise<SecretsStore> {
	try {
		return await secretsStoreFor(await loadWorkspaceSettings(), stage);
	} catch (error) {
		if (error instanceof ConfigNotFound) {
			return new FileSecretsStore(process.cwd());
		}
		throw error;
	}
}

export interface SecretsInitOptions {
	stage: string;
	force?: boolean;
}

export interface SecretsSetOptions {
	stage: string;
}

export interface SecretsShowOptions {
	stage: string;
	reveal?: boolean;
}

export interface SecretsRotateOptions {
	stage: string;
	service?: SecretServiceName;
}

export interface SecretsImportOptions {
	stage: string;
	/** Merge with existing secrets (default: true) */
	merge?: boolean;
}

/**
 * Initialize secrets for a stage.
 * Generates secure random passwords for configured services.
 */
export async function secretsInitCommand(
	options: SecretsInitOptions,
): Promise<void> {
	const { stage, force } = options;

	const store = await storeFor(stage);

	// Check if secrets already exist
	if (!force && (await store.read(stage))) {
		logger.error(
			`Secrets already exist for stage "${stage}". Use --force to overwrite.`,
		);
		process.exit(1);
	}

	// Detect workspace mode for project name and fullstack secrets
	let projectName: string | undefined;
	let workspaceSecrets: Record<string, string> | undefined;
	try {
		const loaded = await loadWorkspaceConfig();
		projectName = loaded.workspace.name;
		const isMultiApp = Object.keys(loaded.workspace.apps).length > 1;

		if (isMultiApp) {
			workspaceSecrets = generateFullstackCustomSecrets(loaded.workspace);
			logger.log('  Detected workspace mode — generating per-app secrets');
		}
	} catch {
		// Not a workspace — single-app mode, skip custom secrets
	}

	// Generate secrets (with project name so DATABASE_URL matches app-specific URLs)
	// No container credentials: the containers are derived from the declared
	// constructs, and reconcile provisions their roles and passwords.
	const secrets = createStageSecrets(stage, [], { projectName });

	if (workspaceSecrets) {
		secrets.custom = workspaceSecrets;
	}

	await store.write(stage, secrets);

	logger.log(`\n✓ Secrets initialized for stage "${stage}"`);
	logger.log(`  Store: ${store.name}`);

	if (secrets.urls.DATABASE_URL) {
		logger.log(`\n  DATABASE_URL: ${maskUrl(secrets.urls.DATABASE_URL)}`);
	}
	if (secrets.urls.REDIS_URL) {
		logger.log(`  REDIS_URL: ${maskUrl(secrets.urls.REDIS_URL)}`);
	}
	if (secrets.urls.STORAGE_ENDPOINT) {
		logger.log(`  STORAGE_ENDPOINT: ${secrets.urls.STORAGE_ENDPOINT}`);
	}

	if (Object.keys(secrets.custom).length > 0) {
		logger.log(`\n  Custom secrets: ${Object.keys(secrets.custom).length}`);
	}

	logger.log(`\n  Use "gkm secrets:show --stage ${stage}" to view secrets`);
	logger.log(
		'  Use "gkm secrets:set <KEY> <VALUE> --stage ' +
			stage +
			'" to add custom secrets',
	);
}

/**
 * Read all data from stdin.
 */
async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];

	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}

	return Buffer.concat(chunks).toString('utf-8').trim();
}

/**
 * Set a custom secret.
 * If value is not provided, reads from stdin.
 */
export async function secretsSetCommand(
	key: string,
	value: string | undefined,
	options: SecretsSetOptions,
): Promise<void> {
	const { stage } = options;

	// Read from stdin if value not provided
	let secretValue = value;
	if (!secretValue) {
		if (process.stdin.isTTY) {
			logger.error(
				'No value provided. Use: gkm secrets:set KEY VALUE --stage <stage>',
			);
			logger.error(
				'Or pipe from stdin: echo "value" | gkm secrets:set KEY --stage <stage>',
			);
			process.exit(1);
		}
		secretValue = await readStdin();
		if (!secretValue) {
			logger.error('No value received from stdin');
			process.exit(1);
		}
	}

	const store = await storeFor(stage);
	const secrets = await store.read(stage);
	if (!secrets) {
		logger.error(
			`Secrets not found for stage "${stage}". Run "gkm secrets:init --stage ${stage}" first.`,
		);
		process.exit(1);
	}

	await assertCredentialValue(key, secretValue, stage);

	await store.write(stage, withCustomSecret(secrets, key, secretValue));
	logger.log(`\n✓ Secret "${key}" set for stage "${stage}" (${store.name})`);
}

/**
 * A third party's credentials, checked against the schema of the construct
 * that reads them before they are stored — what the app would otherwise
 * refuse as it starts. Only a `<ID>_CREDENTIALS` key in a workspace is
 * looked at, so setting anything else loads no construct.
 *
 * @throws {CredentialsInvalid} listing each issue; nothing is saved
 */
async function assertCredentialValue(
	key: string,
	value: string,
	stage: string,
): Promise<void> {
	if (!key.endsWith('_CREDENTIALS')) return;

	let workspace: Awaited<ReturnType<typeof loadWorkspaceSettings>>;
	try {
		workspace = await loadWorkspaceSettings();
	} catch (error) {
		if (error instanceof ConfigNotFound) return;
		throw error;
	}

	const schemas = await loadCredentialSchemas({
		root: workspace.root,
		patterns: constructGlobs(workspace),
	});
	const check = await schemas.check(key, value);
	if (!check.ok) {
		throw new CredentialsInvalid(stage, [{ key, issues: check.issues }], 'set');
	}
}

/**
 * Show secrets for a stage.
 */
export async function secretsShowCommand(
	options: SecretsShowOptions,
): Promise<void> {
	const { stage, reveal } = options;

	const secrets = await (await storeFor(stage)).read(stage);

	if (!secrets) {
		logger.error(
			`No secrets found for stage "${stage}". Run "gkm secrets:init --stage ${stage}" first.`,
		);
		process.exit(1);
	}

	logger.log(`\nSecrets for stage "${stage}":`);
	logger.log(`  Created: ${secrets.createdAt}`);
	logger.log(`  Updated: ${secrets.updatedAt}`);

	// Show service credentials
	logger.log('\nService Credentials:');
	for (const [service, creds] of Object.entries(secrets.services)) {
		if (creds) {
			logger.log(`\n  ${service}:`);
			logger.log(`    host: ${creds.host}`);
			logger.log(`    port: ${creds.port}`);
			logger.log(`    username: ${creds.username}`);
			logger.log(
				`    password: ${reveal ? creds.password : maskPassword(creds.password)}`,
			);
			if (creds.database) {
				logger.log(`    database: ${creds.database}`);
			}
			if (creds.bucket) {
				logger.log(`    bucket: ${creds.bucket}`);
			}
		}
	}

	// Show URLs
	logger.log('\nConnection URLs:');
	if (secrets.urls.DATABASE_URL) {
		logger.log(
			`  DATABASE_URL: ${reveal ? secrets.urls.DATABASE_URL : maskUrl(secrets.urls.DATABASE_URL)}`,
		);
	}
	if (secrets.urls.REDIS_URL) {
		logger.log(
			`  REDIS_URL: ${reveal ? secrets.urls.REDIS_URL : maskUrl(secrets.urls.REDIS_URL)}`,
		);
	}
	if (secrets.urls.STORAGE_ENDPOINT) {
		logger.log(`  STORAGE_ENDPOINT: ${secrets.urls.STORAGE_ENDPOINT}`);
	}

	// Show custom secrets
	const customKeys = Object.keys(secrets.custom);
	if (customKeys.length > 0) {
		logger.log('\nCustom Secrets:');
		for (const [key, value] of Object.entries(secrets.custom)) {
			logger.log(`  ${key}: ${reveal ? value : maskPassword(value)}`);
		}
	}

	if (!reveal) {
		logger.log('\nUse --reveal to show actual values');
	}
}

/**
 * Rotate passwords for services.
 */
export async function secretsRotateCommand(
	options: SecretsRotateOptions,
): Promise<void> {
	const { stage, service } = options;

	const store = await storeFor(stage);
	const secrets = await store.read(stage);

	if (!secrets) {
		logger.error(
			`No secrets found for stage "${stage}". Run "gkm secrets:init --stage ${stage}" first.`,
		);
		process.exit(1);
	}

	if (service) {
		// Rotate specific service
		if (!secrets.services[service]) {
			logger.error(`Service "${service}" not configured in stage "${stage}"`);
			process.exit(1);
		}

		const updated = rotateServicePassword(secrets, service);
		await store.write(stage, updated);
		logger.log(`\n✓ Password rotated for ${service} in stage "${stage}"`);
	} else {
		// Rotate all services
		let updated = secrets;
		const services = Object.keys(secrets.services) as SecretServiceName[];

		for (const svc of services) {
			updated = rotateServicePassword(updated, svc);
		}

		await store.write(stage, updated);
		logger.log(
			`\n✓ Passwords rotated for all services in stage "${stage}": ${services.join(', ')}`,
		);
	}

	logger.log(`\nUse "gkm secrets:show --stage ${stage}" to view new values`);
}

/**
 * Import secrets from a JSON file.
 */
export async function secretsImportCommand(
	file: string,
	options: SecretsImportOptions,
): Promise<void> {
	const { stage, merge = true } = options;

	// Check if file exists
	if (!existsSync(file)) {
		logger.error(`File not found: ${file}`);
		process.exit(1);
	}

	// Read and parse JSON file
	let importedSecrets: Record<string, string>;
	try {
		const content = await readFile(file, 'utf-8');
		importedSecrets = JSON.parse(content);

		// Validate it's a flat object with string values
		if (typeof importedSecrets !== 'object' || importedSecrets === null) {
			throw new Error('JSON must be an object');
		}

		for (const [key, value] of Object.entries(importedSecrets)) {
			if (typeof value !== 'string') {
				throw new Error(
					`Value for "${key}" must be a string, got ${typeof value}`,
				);
			}
		}
	} catch (error) {
		logger.error(
			`Failed to parse JSON file: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
		);
		process.exit(1);
	}

	// Check if secrets exist for stage
	const store = await storeFor(stage);
	const secrets = await store.read(stage);

	if (!secrets) {
		logger.error(
			`No secrets found for stage "${stage}". Run "gkm secrets:init --stage ${stage}" first.`,
		);
		process.exit(1);
	}

	// Merge or replace custom secrets
	const updatedCustom = merge
		? { ...secrets.custom, ...importedSecrets }
		: importedSecrets;

	const updated = {
		...secrets,
		updatedAt: new Date().toISOString(),
		custom: updatedCustom,
	};

	await store.write(stage, updated);

	const importedCount = Object.keys(importedSecrets).length;
	const totalCount = Object.keys(updatedCustom).length;

	logger.log(`\n✓ Imported ${importedCount} secrets for stage "${stage}"`);

	if (merge && totalCount > importedCount) {
		logger.log(`  Total custom secrets: ${totalCount}`);
	}

	logger.log('\n  Imported keys:');
	for (const key of Object.keys(importedSecrets)) {
		logger.log(`    - ${key}`);
	}
}

/**
 * Mask password in a URL for display.
 */
export function maskUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.password) {
			parsed.password = maskPassword(parsed.password);
		}
		return parsed.toString();
	} catch {
		return url;
	}
}
