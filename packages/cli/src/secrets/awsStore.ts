/**
 * What the two AWS secrets stores share: how a client finds its credentials,
 * what it says when it has none, and how big a stage may be before AWS would
 * refuse it.
 */

import { GkmError } from '../errors';

export interface AwsStoreOptions {
	/** The workspace name, which scopes where the stage is kept. */
	project: string;
	region: string;
	/**
	 * A named AWS profile, resolved with `fromIni` only. The default chain
	 * reads AWS_* from the environment first, so exported staging keys would
	 * win over `--profile prod` and put production's secrets in staging.
	 */
	profile?: string;
	/** For tests: an endpoint such as the AWS emulator. */
	endpoint?: string;
}

/** The client config both stores build their SDK client from. */
export async function awsClientConfig(options: AwsStoreOptions): Promise<{
	region: string;
	endpoint?: string;
	credentials?: ReturnType<
		typeof import('@aws-sdk/credential-providers').fromIni
	>;
}> {
	const config: Awaited<ReturnType<typeof awsClientConfig>> = {
		region: options.region,
	};
	if (options.profile) {
		const { fromIni } = await import('@aws-sdk/credential-providers');
		config.credentials = fromIni({ profile: options.profile });
	}
	if (options.endpoint) {
		config.endpoint = options.endpoint;
	}
	return config;
}

/**
 * A stage's secrets, serialized, are larger than the store can hold: 8 KB for
 * an SSM parameter (advanced tier), 64 KB for a Secrets Manager secret.
 *
 * Refused before AWS is called, so nothing half-written is left behind and
 * the answer is not a bare `ValidationException`.
 */
export class StageSecretsTooLarge extends GkmError {
	constructor(
		readonly stage: string,
		readonly store: string,
		readonly bytes: number,
		readonly limit: number,
	) {
		super(
			`The secrets for stage "${stage}" are ${bytes} bytes, more than the ${limit} bytes ${store} holds in one ${store === 'ssm' ? 'parameter' : 'secret'}. ` +
				(store === 'ssm'
					? `Keep them in Secrets Manager instead, which holds up to 64 KB: set secrets.store to { provider: 'secrets-manager', region } in gkm.config.ts, then move the stage with gkm secrets:migrate --stage ${stage} --from ssm.`
					: 'Remove credentials the stage no longer uses, or keep the largest ones somewhere they are fetched from at runtime.'),
		);
		this.name = 'StageSecretsTooLarge';
	}
}

/** The stage serialized, refused if it is larger than `limit` bytes. */
export function serializeWithin(
	stage: string,
	store: string,
	value: unknown,
	limit: number,
): string {
	const serialized = JSON.stringify(value);
	const bytes = Buffer.byteLength(serialized, 'utf8');
	if (bytes > limit) {
		throw new StageSecretsTooLarge(stage, store, bytes, limit);
	}
	return serialized;
}

/** Where each AWS store keeps a stage's secrets, as a person reads it. */
const AWS_STORES: Record<string, string> = {
	ssm: 'SSM Parameter Store',
	'secrets-manager': 'Secrets Manager',
};

/** Why the stage's account could not be reached. */
export type StageSecretsUnreadableReason = 'no-credentials' | 'expired';

export interface StageSecretsUnreadableInput {
	stage: string;
	/** The store's name: `ssm`, `secrets-manager`. */
	store: string;
	/** The AWS profile the credentials were looked up with, where one was. */
	profile?: string;
	/** Whether the stage was being read or written. */
	access?: 'read' | 'write';
	reason?: StageSecretsUnreadableReason;
}

/**
 * A deployed stage's secrets are kept in its AWS account, and no AWS
 * credentials were found to reach them with — or the ones found have expired.
 *
 * Raised by the AWS stores themselves, on a read or a write, so every command
 * that touches a stage's secrets says it the same way.
 */
export class StageSecretsUnreadable extends GkmError {
	readonly stage: string;
	readonly store: string;
	readonly profile: string | undefined;
	readonly access: 'read' | 'write';
	readonly reason: StageSecretsUnreadableReason;

	constructor(input: StageSecretsUnreadableInput, cause?: unknown) {
		const { stage, store, profile } = input;
		const access = input.access ?? 'read';
		const reason = input.reason ?? 'no-credentials';
		const where = AWS_STORES[store] ?? `the '${store}' store`;
		// How to name the account: the command's --profile, where it takes
		// one, or the SDK's own variable.
		const named =
			'--profile <profile> where the command takes it, or AWS_PROFILE=<profile>';
		const lacking =
			reason === 'expired'
				? profile
					? `the AWS profile '${profile}' signed in, but its session has expired. `
					: 'the AWS credentials found have expired. '
				: profile
					? `the AWS profile '${profile}' has no credentials to ${access} them with. `
					: `no AWS credentials were found to ${access} them with. `;
		const fix = profile
			? `Sign in to it (aws sso login --profile ${profile}) or name another: ${named}.`
			: reason === 'expired'
				? `Export fresh ones, or name the account's profile: ${named}.`
				: `Name the account's profile: ${named}.`;
		super(
			`The '${stage}' stage's secrets are kept in ${where}, in the stage's AWS account, and ` +
				lacking +
				fix,
			cause === undefined ? undefined : { cause },
		);
		this.name = 'StageSecretsUnreadable';
		this.stage = stage;
		this.store = store;
		this.profile = profile;
		this.access = access;
		this.reason = reason;
	}
}

/**
 * Why an AWS call failed for want of credentials, by the SDK's error name —
 * its message being free to change — or undefined when it failed for any
 * other reason.
 *
 * - `CredentialsProviderError`: the credential chain found nothing, or a
 *   profile's SSO session is missing or expired (the SSO provider wraps its
 *   token errors in this one).
 * - `TokenProviderError`: an SSO token, should one reach here unwrapped.
 * - `ExpiredTokenException`/`ExpiredToken`: credentials were found, and AWS
 *   refused them as expired.
 */
export function credentialsFailure(
	error: unknown,
): StageSecretsUnreadableReason | undefined {
	const name = (error as Error | undefined)?.name;
	if (name === 'CredentialsProviderError' || name === 'TokenProviderError') {
		return 'no-credentials';
	}
	if (name === 'ExpiredTokenException' || name === 'ExpiredToken') {
		return 'expired';
	}
	return undefined;
}

/**
 * Run one AWS call of a store, refusing a failure for want of credentials
 * with {@link StageSecretsUnreadable}. Any other failure is the store's own,
 * and passes through.
 */
export async function withStageCredentials<T>(
	context: {
		stage: string;
		store: string;
		profile: string | undefined;
		access: 'read' | 'write';
	},
	call: () => Promise<T>,
): Promise<T> {
	try {
		return await call();
	} catch (error) {
		const reason = credentialsFailure(error);
		if (reason === undefined) throw error;
		throw new StageSecretsUnreadable(
			{
				...context,
				// The profile the SDK's default chain read, when none was named.
				profile: context.profile ?? (process.env.AWS_PROFILE || undefined),
				reason,
			},
			error,
		);
	}
}
