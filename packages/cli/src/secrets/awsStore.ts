/**
 * What the two AWS secrets stores share: how a client finds its credentials,
 * and how big a stage may be before AWS would refuse it.
 */

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
export class StageSecretsTooLarge extends Error {
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
