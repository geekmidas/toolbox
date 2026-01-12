import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';
import {
	getCredentialsPath,
	getDokployCredentials,
	removeDokployCredentials,
	storeDokployCredentials,
} from './credentials';

const logger = console;

export interface LoginOptions {
	/** Service to login to */
	service: 'dokploy';
	/** API token (if not provided, will prompt) */
	token?: string;
	/** Endpoint URL */
	endpoint?: string;
}

export interface LogoutOptions {
	/** Service to logout from */
	service?: 'dokploy' | 'all';
}

/**
 * Validate Dokploy token by making a test API call
 */
export async function validateDokployToken(
	endpoint: string,
	token: string,
): Promise<boolean> {
	const { DokployApi } = await import('../deploy/dokploy-api');
	const api = new DokployApi({ baseUrl: endpoint, token });
	return api.validateToken();
}

/**
 * Prompt for input (handles both TTY and non-TTY)
 */
async function prompt(message: string, hidden = false): Promise<string> {
	if (!process.stdin.isTTY) {
		throw new Error(
			'Interactive input required. Please provide --token option.',
		);
	}

	if (hidden) {
		// For hidden input, use raw mode directly without readline
		process.stdout.write(message);

		return new Promise((resolve, reject) => {
			let value = '';

			const cleanup = () => {
				process.stdin.setRawMode(false);
				process.stdin.pause();
				process.stdin.removeListener('data', onData);
				process.stdin.removeListener('error', onError);
			};

			const onError = (err: Error) => {
				cleanup();
				reject(err);
			};

			const onData = (char: Buffer) => {
				const c = char.toString();

				if (c === '\n' || c === '\r') {
					cleanup();
					process.stdout.write('\n');
					resolve(value);
				} else if (c === '\u0003') {
					// Ctrl+C
					cleanup();
					process.stdout.write('\n');
					process.exit(1);
				} else if (c === '\u007F' || c === '\b') {
					// Backspace
					if (value.length > 0) {
						value = value.slice(0, -1);
					}
				} else {
					value += c;
				}
			};

			process.stdin.setRawMode(true);
			process.stdin.resume();
			process.stdin.on('data', onData);
			process.stdin.on('error', onError);
		});
	} else {
		// For visible input, use readline
		const rl = readline.createInterface({ input, output });
		try {
			return await rl.question(message);
		} finally {
			rl.close();
		}
	}
}

/**
 * Login to a service
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
	const { service, token: providedToken, endpoint: providedEndpoint } = options;

	if (service === 'dokploy') {
		logger.log('\n🔐 Logging in to Dokploy...\n');

		// Get endpoint
		let endpoint = providedEndpoint;
		if (!endpoint) {
			endpoint = await prompt(
				'Dokploy URL (e.g., https://dokploy.example.com): ',
			);
		}

		// Normalize endpoint (remove trailing slash)
		endpoint = endpoint.replace(/\/$/, '');

		// Validate endpoint format
		try {
			new URL(endpoint);
		} catch {
			logger.error('Invalid URL format');
			process.exit(1);
		}

		// Get token
		let token = providedToken;
		if (!token) {
			logger.log(`\nGenerate a token at: ${endpoint}/settings/profile\n`);
			token = await prompt('API Token: ', true);
		}

		if (!token) {
			logger.error('Token is required');
			process.exit(1);
		}

		// Validate token
		logger.log('\nValidating credentials...');
		const isValid = await validateDokployToken(endpoint, token);

		if (!isValid) {
			logger.error(
				'\n✗ Invalid credentials. Please check your token and try again.',
			);
			process.exit(1);
		}

		// Store credentials
		await storeDokployCredentials(token, endpoint);

		logger.log('\n✓ Successfully logged in to Dokploy!');
		logger.log(`  Endpoint: ${endpoint}`);
		logger.log(`  Credentials stored in: ${getCredentialsPath()}`);
		logger.log(
			'\nYou can now use deploy commands without setting DOKPLOY_API_TOKEN.',
		);
	}
}

/**
 * Logout from a service
 */
export async function logoutCommand(options: LogoutOptions): Promise<void> {
	const { service = 'dokploy' } = options;

	if (service === 'all') {
		const dokployRemoved = await removeDokployCredentials();

		if (dokployRemoved) {
			logger.log('\n✓ Logged out from all services');
		} else {
			logger.log('\nNo stored credentials found');
		}
		return;
	}

	if (service === 'dokploy') {
		const removed = await removeDokployCredentials();

		if (removed) {
			logger.log('\n✓ Logged out from Dokploy');
		} else {
			logger.log('\nNo Dokploy credentials found');
		}
	}
}

/**
 * Show current login status
 */
export async function whoamiCommand(): Promise<void> {
	logger.log('\n📋 Current credentials:\n');

	const dokploy = await getDokployCredentials();

	if (dokploy) {
		logger.log('  Dokploy:');
		logger.log(`    Endpoint: ${dokploy.endpoint}`);
		logger.log(`    Token: ${maskToken(dokploy.token)}`);
	} else {
		logger.log('  Dokploy: Not logged in');
	}

	logger.log(`\n  Credentials file: ${getCredentialsPath()}`);
}

/**
 * Mask a token for display
 */
export function maskToken(token: string): string {
	if (token.length <= 8) {
		return '****';
	}
	return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

// Re-export credentials utilities for use in other modules
export {
	getDokployCredentials,
	getDokployEndpoint,
	getDokployRegistryId,
	getDokployToken,
	storeDokployCredentials,
	storeDokployRegistryId,
} from './credentials';
