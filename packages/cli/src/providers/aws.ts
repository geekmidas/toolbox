/**
 * The AWS account a provider provisions in — the stage's, found the way the
 * SSM and Secrets Manager stores find it.
 *
 * 1. `--profile`, resolved on its own: exported keys left over from another
 *    account never win over a profile someone named.
 * 2. `AWS_PROFILE`, else `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` — the
 *    deploy's own `aws` credential kind (`storedCredentials`).
 * 3. The SDK's default chain: `~/.aws` default profile, SSO, a role. In CI,
 *    whatever `aws-actions/configure-aws-credentials` exported.
 *
 * None of them: the provider has no provisioning credentials, and the stage
 * is treated as `external`.
 */

import {
	type AwsCredential,
	storedCredentials,
} from '../deploy/credentials.js';
import type { CredentialLookup } from './types.js';

/** An AWS credential, or the default chain the SDK resolves itself. */
export type AwsProvisioning =
	| AwsCredential
	| {
			chain: true;
			region?: string;
	  };

export async function awsProvisioningCredentials(
	lookup: CredentialLookup,
): Promise<AwsProvisioning | undefined> {
	const region = lookup.env.AWS_REGION ?? lookup.env.AWS_DEFAULT_REGION;
	const where = region ? { region } : {};
	if (lookup.profile) return { profile: lookup.profile, ...where };

	const stored = await storedCredentials({
		env: lookup.env,
		...(lookup.home ? { home: lookup.home } : {}),
	}).get({ kind: 'aws', stage: lookup.stage });
	if (stored) return stored;

	try {
		const { fromNodeProviderChain } = await import(
			'@aws-sdk/credential-providers'
		);
		await fromNodeProviderChain({ timeout: 1000, maxRetries: 0 })();
		return { chain: true, ...where };
	} catch {
		return undefined;
	}
}

/**
 * An S3-compatible endpoint the environment points the SDK at — the AWS
 * emulator in tests. The SDK reads it itself; it is read here too, because
 * an emulator takes path-style requests, and a key written for one has to
 * say where it is.
 */
export function awsEndpoint(
	env: NodeJS.ProcessEnv,
	service: 'S3' | 'IAM',
): string | undefined {
	return env[`AWS_ENDPOINT_URL_${service}`] ?? env.AWS_ENDPOINT_URL;
}

/** An SDK client's config for a provisioning credential. */
export async function awsClientConfig(
	credential: AwsProvisioning,
	region: string,
): Promise<{
	region: string;
	credentials?:
		| ReturnType<typeof import('@aws-sdk/credential-providers').fromIni>
		| { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
}> {
	if ('profile' in credential) {
		const { fromIni } = await import('@aws-sdk/credential-providers');
		return { region, credentials: fromIni({ profile: credential.profile }) };
	}
	if ('accessKeyId' in credential) {
		return {
			region,
			credentials: {
				accessKeyId: credential.accessKeyId,
				secretAccessKey: credential.secretAccessKey,
				...(credential.sessionToken
					? { sessionToken: credential.sessionToken }
					: {}),
			},
		};
	}
	return { region };
}
