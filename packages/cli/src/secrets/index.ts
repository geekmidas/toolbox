import { loadConfig } from '../config';
import type { ComposeServiceName, ComposeServicesConfig } from '../types';
import { createStageSecrets, rotateServicePassword } from './generator';
import {
	maskPassword,
	readStageSecrets,
	secretsExist,
	setCustomSecret,
	writeStageSecrets,
} from './storage';

const logger = console;

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
	service?: ComposeServiceName;
}

/**
 * Extract service names from compose config.
 */
function getServicesFromConfig(
	services: ComposeServicesConfig | ComposeServiceName[] | undefined,
): ComposeServiceName[] {
	if (!services) {
		return [];
	}

	if (Array.isArray(services)) {
		return services;
	}

	// Object format - get keys where value is truthy
	return (Object.entries(services) as [ComposeServiceName, unknown][])
		.filter(([, config]) => config)
		.map(([name]) => name);
}

/**
 * Initialize secrets for a stage.
 * Generates secure random passwords for configured services.
 */
export async function secretsInitCommand(
	options: SecretsInitOptions,
): Promise<void> {
	const { stage, force } = options;

	// Check if secrets already exist
	if (!force && secretsExist(stage)) {
		logger.error(
			`Secrets already exist for stage "${stage}". Use --force to overwrite.`,
		);
		process.exit(1);
	}

	// Load config to get services
	const config = await loadConfig();
	const services = getServicesFromConfig(config.docker?.compose?.services);

	if (services.length === 0) {
		logger.warn(
			'No services configured in docker.compose.services. Creating secrets with empty services.',
		);
	}

	// Generate secrets
	const secrets = createStageSecrets(stage, services);

	// Write to file
	await writeStageSecrets(secrets);

	logger.log(`\n✓ Secrets initialized for stage "${stage}"`);
	logger.log(`  Location: .gkm/secrets/${stage}.json`);
	logger.log('\n  Generated credentials for:');

	for (const service of services) {
		logger.log(`    - ${service}`);
	}

	if (secrets.urls.DATABASE_URL) {
		logger.log(`\n  DATABASE_URL: ${maskUrl(secrets.urls.DATABASE_URL)}`);
	}
	if (secrets.urls.REDIS_URL) {
		logger.log(`  REDIS_URL: ${maskUrl(secrets.urls.REDIS_URL)}`);
	}
	if (secrets.urls.RABBITMQ_URL) {
		logger.log(`  RABBITMQ_URL: ${maskUrl(secrets.urls.RABBITMQ_URL)}`);
	}

	logger.log('\n  Use "gkm secrets:show --stage ' + stage + '" to view secrets');
	logger.log(
		'  Use "gkm secrets:set <KEY> <VALUE> --stage ' +
			stage +
			'" to add custom secrets',
	);
}

/**
 * Set a custom secret.
 */
export async function secretsSetCommand(
	key: string,
	value: string,
	options: SecretsSetOptions,
): Promise<void> {
	const { stage } = options;

	try {
		await setCustomSecret(stage, key, value);
		logger.log(`\n✓ Secret "${key}" set for stage "${stage}"`);
	} catch (error) {
		logger.error(
			error instanceof Error ? error.message : 'Failed to set secret',
		);
		process.exit(1);
	}
}

/**
 * Show secrets for a stage.
 */
export async function secretsShowCommand(
	options: SecretsShowOptions,
): Promise<void> {
	const { stage, reveal } = options;

	const secrets = await readStageSecrets(stage);

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
			if (creds.vhost) {
				logger.log(`    vhost: ${creds.vhost}`);
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
	if (secrets.urls.RABBITMQ_URL) {
		logger.log(
			`  RABBITMQ_URL: ${reveal ? secrets.urls.RABBITMQ_URL : maskUrl(secrets.urls.RABBITMQ_URL)}`,
		);
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

	const secrets = await readStageSecrets(stage);

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
		await writeStageSecrets(updated);
		logger.log(`\n✓ Password rotated for ${service} in stage "${stage}"`);
	} else {
		// Rotate all services
		let updated = secrets;
		const services = Object.keys(secrets.services) as ComposeServiceName[];

		for (const svc of services) {
			updated = rotateServicePassword(updated, svc);
		}

		await writeStageSecrets(updated);
		logger.log(
			`\n✓ Passwords rotated for all services in stage "${stage}": ${services.join(', ')}`,
		);
	}

	logger.log('\nUse "gkm secrets:show --stage ' + stage + '" to view new values');
}

/**
 * Mask password in a URL for display.
 */
function maskUrl(url: string): string {
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
