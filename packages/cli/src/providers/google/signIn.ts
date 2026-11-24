/**
 * How gkm signs in to Google, for every command and provider: the file
 * `GOOGLE_APPLICATION_CREDENTIALS` names when it is set — what
 * `google-github-actions/auth` leaves a CI job — else gkm's own gcloud
 * sign-in. Never the person's own gcloud configuration.
 */

import { join } from 'node:path';
import { credentialsFileToken } from './credentialsFile.js';
import {
	CLOUD_PLATFORM_SCOPE,
	type GoogleSignIn,
	gcloudConfig,
	gcloudSignIn,
} from './gcloud.js';

/** Where a sign-in comes from: for messages, and for tests. */
export function googleCredentialSource(
	env: NodeJS.ProcessEnv = process.env,
): 'file' | 'gcloud' {
	return env.GOOGLE_APPLICATION_CREDENTIALS ? 'file' : 'gcloud';
}

/**
 * The one Google sign-in. `home` is the CLI's home, where gkm's gcloud
 * config is kept (default: `GKM_HOME`, else `~/.gkm`).
 */
export function googleSignIn(
	env: NodeJS.ProcessEnv = process.env,
	home?: string,
): GoogleSignIn {
	const file = env.GOOGLE_APPLICATION_CREDENTIALS;
	if (file) {
		return {
			token: ({ scopes = [CLOUD_PLATFORM_SCOPE] }) =>
				credentialsFileToken(file, scopes),
		};
	}
	return gcloudSignIn(home ? join(home, 'gcloud') : gcloudConfig(env));
}
