/**
 * The credentials `gkm deploy` can ask a person for. CLI layer only.
 *
 * `deploy()` asks its `CredentialProvider` and stops with `MissingCredential`
 * when the answer is nothing. At a terminal, `gkm deploy` would rather ask:
 * this provider reads the environment and the stored login first, and only
 * when both are empty prompts — and stores a Dokploy login it validated, so
 * the next deploy does not ask again. With no terminal it answers nothing, and
 * the deploy says what was missing instead of waiting on a prompt nobody sees.
 */

import { validateDokployToken } from '../auth';
import { storeDokployCredentials } from '../auth/credentials';
import { output } from '../output';
import { canPrompt, prompt } from '../prompt';
import {
	type CredentialProvider,
	type CredentialRequest,
	chainCredentials,
	storedCredentials,
} from './credentials';

const logger = output;

/** What answers a deploy prompt without a terminal. */
const INSTEAD = 'Please configure manually.';

/** The Dokploy URL typed at the prompt is not a URL. */
export class DokployEndpointInvalid extends Error {
	constructor(readonly endpoint: string) {
		super('Invalid URL format');
		this.name = 'DokployEndpointInvalid';
	}
}

/** Dokploy refused the token typed at the prompt; nothing was stored. */
export class DokployTokenRejected extends Error {
	constructor(readonly endpoint: string) {
		super('Invalid credentials. Please check your token.');
		this.name = 'DokployTokenRejected';
	}
}

/** Asks the person at the terminal for what nothing else supplied. */
function asking(): CredentialProvider {
	return {
		async get(asked) {
			if (!canPrompt()) return undefined;
			// The union, so checking `kind` narrows it: `K` itself never is.
			const request = asked as CredentialRequest;

			if (request.kind === 'dokploy') {
				logger.log("\n📋 Dokploy credentials not found. Let's set them up.");
				const endpoint = (
					await prompt('Dokploy URL (e.g., https://dokploy.example.com): ', {
						instead: INSTEAD,
					})
				).replace(/\/$/, '');

				try {
					new URL(endpoint);
				} catch {
					throw new DokployEndpointInvalid(endpoint);
				}

				logger.log(`\nGenerate a token at: ${endpoint}/settings/profile\n`);
				const token = await prompt('API Token: ', {
					hidden: true,
					instead: INSTEAD,
				});

				logger.log('\nValidating credentials...');
				if (!(await validateDokployToken(endpoint, token))) {
					throw new DokployTokenRejected(endpoint);
				}

				await storeDokployCredentials(token, endpoint);
				logger.log('✓ Credentials saved');
				return { endpoint, token } as never;
			}

			logger.log(
				`   Dokploy has no registry for ${request.url}. Let's create one.`,
			);
			const username = await prompt('Registry username: ', {
				instead: INSTEAD,
			});
			const password = await prompt('Registry password/token: ', {
				hidden: true,
				instead: INSTEAD,
			});
			return { username, password } as never;
		},
	};
}

/**
 * The environment, then the stored login, then — at a terminal — the person
 * running the command.
 */
export function terminalCredentials(
	base: CredentialProvider = storedCredentials(),
): CredentialProvider {
	return chainCredentials(base, asking());
}
