import { prompt as ask } from '../prompt';
import {
	getCredentialsPath,
	getDokployCredentials,
	readCredentials,
	removeDokployCredentials,
	removeGoDaddyCredentials,
	storeDokployCredentials,
	storeGoDaddyToken,
	storeHostingerToken,
} from './credentials';

const logger = console;

export interface LoginOptions {
	/** Which provider's credentials to store — the same word `gkm deploy` uses. */
	provider: 'dokploy' | 'hostinger' | 'godaddy';
	/** API token (if not provided, will prompt) */
	token?: string;
	/** Endpoint URL */
	endpoint?: string;
	/** The CLI's home, holding `credentials.json` — `GKM_HOME`/`~/.gkm` by default. */
	home?: string;
}

export interface LogoutOptions {
	/** Whose credentials to remove — `all` clears every stored provider. */
	provider?: 'dokploy' | 'godaddy' | 'all';
}

/**
 * Validate Dokploy token by making a test API call
 */
export async function validateDokployToken(
	endpoint: string,
	token: string,
): Promise<boolean> {
	const { DokployApi } = await import('../target/dokploy/dokploy-api');
	const api = new DokployApi({ baseUrl: endpoint, token });
	return api.validateToken();
}

/** What answers a login prompt without a terminal. */
const LOGIN_INSTEAD = 'Please provide --token option.';

/**
 * Login to a service
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
	const {
		provider,
		token: providedToken,
		endpoint: providedEndpoint,
	} = options;

	if (provider === 'dokploy') {
		logger.log('\n🔐 Logging in to Dokploy...\n');

		// Get endpoint
		let endpoint = providedEndpoint;
		if (!endpoint) {
			endpoint = await ask(
				'Dokploy URL (e.g., https://dokploy.example.com): ',
				{
					instead: LOGIN_INSTEAD,
				},
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
			token = await ask('API Token: ', {
				hidden: true,
				instead: LOGIN_INSTEAD,
			});
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

	if (provider === 'godaddy') {
		await loginGoDaddy(options);
		return;
	}

	if (provider === 'hostinger') {
		// The DNS provider has told people to run this since it was written, and
		// this branch did not exist — so the only way to supply the token was the
		// environment variable, which the message does not mention.
		logger.log('\n🔐 Logging in to Hostinger...\n');

		let token = providedToken;
		if (!token) {
			logger.log(
				'\nGenerate a token at: https://hpanel.hostinger.com/profile/api\n',
			);
			token = await ask('API Token: ', {
				hidden: true,
				instead: LOGIN_INSTEAD,
			});
		}

		if (!token) {
			logger.error('Token is required');
			process.exit(1);
		}

		// Stored without validating, and that is worth saying rather than hiding.
		// Hostinger's DNS API is zone-scoped — every endpoint takes a domain — so
		// there is nothing to call that means "is this token good" without
		// already knowing a domain this account owns. A check against a guessed
		// one would fail for two different reasons and report one.
		await storeHostingerToken(token);

		logger.log('\n✓ Hostinger token stored.');
		logger.log(`  Credentials stored in: ${getCredentialsPath()}`);
		logger.log(
			'  Not validated here: every DNS endpoint is scoped to a domain, so the\n' +
				'  first deploy that touches DNS is where a bad token reports itself.',
		);
		logger.log(
			'\nYou can now use it as a DNS provider without setting HOSTINGER_API_TOKEN.',
		);
	}
}

/**
 * Store a GoDaddy Personal Access Token. Not validated: the only call that
 * proves a token without a domain is an account call (`GET /v1/domains`),
 * which a token scoped to `domains.dns:update` alone may not make — the first
 * `gkm setup` that writes a record is where a bad token reports itself.
 */
async function loginGoDaddy(options: LoginOptions): Promise<void> {
	logger.log('\n🔐 Logging in to GoDaddy...\n');

	let token = options.token;
	if (!token) {
		logger.log(
			'\nCreate a Personal Access Token in the GoDaddy developer dashboard' +
				'\n(https://developer.godaddy.com) with only the domains.dns:update scope.\n',
		);
		token = await ask('Personal Access Token: ', {
			hidden: true,
			instead: LOGIN_INSTEAD,
		});
	}
	if (!token) {
		logger.error('Token is required');
		process.exit(1);
	}

	const where = options.home ? { home: options.home } : undefined;
	await storeGoDaddyToken(token, where);

	logger.log('\n✓ GoDaddy token stored.');
	logger.log(`  Token: ${maskToken(token)}`);
	logger.log(`  Credentials stored in: ${getCredentialsPath(where)}`);
	logger.log(
		'  Not validated here: proving a token without a domain needs an account\n' +
			'  scope a DNS-only token does not have, so the first gkm setup that\n' +
			'  writes a record is where a bad token reports itself.',
	);
	logger.log(
		'\nYou can now use it as a DNS provider without setting GODADDY_API_TOKEN.',
	);
}

/**
 * Logout from a service
 */
export async function logoutCommand(options: LogoutOptions): Promise<void> {
	const { provider = 'dokploy' } = options;

	if (provider === 'all') {
		const dokployRemoved = await removeDokployCredentials();
		const godaddyRemoved = await removeGoDaddyCredentials();

		if (dokployRemoved || godaddyRemoved) {
			logger.log('\n✓ Logged out from all services');
		} else {
			logger.log('\nNo stored credentials found');
		}
		return;
	}

	if (provider === 'godaddy') {
		const removed = await removeGoDaddyCredentials();
		logger.log(
			removed
				? '\n✓ Logged out from GoDaddy'
				: '\nNo GoDaddy credentials found',
		);
		return;
	}

	if (provider === 'dokploy') {
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

	const godaddy = (await readCredentials()).godaddy;
	logger.log(
		godaddy
			? `  GoDaddy:\n    Token: ${maskToken(godaddy.token)}`
			: '  GoDaddy: Not logged in',
	);

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
