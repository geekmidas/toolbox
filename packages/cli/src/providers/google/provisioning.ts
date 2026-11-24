/**
 * A Google provider's provisioning credential: the sign-in, and the
 * `--project` the run was given. What a Google `ResourceProvider` returns
 * from `credentials()`, so its `ensure()` has both.
 */

import { canPrompt } from '../../prompt.js';
import type { CredentialLookup } from '../types.js';
import {
	CLOUD_PLATFORM_SCOPE,
	GcloudMissing,
	type GoogleSignIn,
	GoogleSignInRequired,
} from './gcloud.js';
import { googleCredentialSource, googleSignIn } from './signIn.js';

export interface GoogleCredential {
	signIn: GoogleSignIn;
	/** Where it comes from: the credentials file (CI), or gkm's gcloud. */
	source: 'file' | 'gcloud';
	/** Whether a sign-in may open a browser. */
	interactive: boolean;
	/** `--project`, when given. */
	project?: string;
}

/** How a Google provider says it is supplied, for messages. */
export const GOOGLE_PROVISIONING = {
	env: ['GOOGLE_APPLICATION_CREDENTIALS'],
	describe:
		"GOOGLE_APPLICATION_CREDENTIALS (google-github-actions/auth sets it in CI), or sign in with gkm's gcloud from a terminal",
} as const;

/**
 * The credential, or `undefined` when there is none: no credentials file,
 * and gkm's gcloud is not signed in with no terminal to sign in from.
 */
export async function googleProvisioningCredentials(
	lookup: CredentialLookup,
	options: { scopes?: readonly string[]; interactive?: boolean } = {},
): Promise<GoogleCredential | undefined> {
	const source = googleCredentialSource(lookup.env);
	const interactive = options.interactive ?? canPrompt();
	const credential: GoogleCredential = {
		signIn: googleSignIn(lookup.env, lookup.home),
		source,
		interactive,
		...(lookup.project ? { project: lookup.project } : {}),
	};
	if (source === 'file' || interactive) return credential;
	try {
		await credential.signIn.token({
			interactive: false,
			scopes: options.scopes ?? [CLOUD_PLATFORM_SCOPE],
		});
		return credential;
	} catch (error) {
		if (error instanceof GoogleSignInRequired || error instanceof GcloudMissing)
			return undefined;
		throw error;
	}
}
