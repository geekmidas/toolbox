import { S3_PROVISIONING } from '../s3/config.js';
import type { ProviderConfig } from '../types.js';
import { SesProviderConfigInvalid } from './errors.js';

/** `inbox: { provider: 'ses' }` — each inbox received by SES in the stage's account. */
export interface SesInboxConfig {
	provider: 'ses';
	/**
	 * Where mail is received, and the inbox's bucket and topic live. Defaults
	 * to the secrets store's region, then `AWS_REGION` — and must be one SES
	 * receives mail in.
	 */
	region?: string;
}

const FIELDS = ['provider', 'region'] as const;

const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;

export function checkSesConfig(
	stage: string,
	config: ProviderConfig,
): SesInboxConfig {
	const entry = config as unknown as Record<string, unknown>;
	for (const field of Object.keys(entry)) {
		if (!(FIELDS as readonly string[]).includes(field)) {
			throw new SesProviderConfigInvalid(
				stage,
				field,
				entry[field],
				`the ses provider takes ${FIELDS.slice(1).join(', ')} only`,
			);
		}
	}
	if (
		entry.region !== undefined &&
		(typeof entry.region !== 'string' || !REGION.test(entry.region))
	) {
		throw new SesProviderConfigInvalid(
			stage,
			'region',
			entry.region,
			"set it to an AWS region code SES receives mail in, like 'eu-west-1'",
		);
	}
	return entry as unknown as SesInboxConfig;
}

/** The stage's AWS account, as every AWS provider asks for it. */
export const SES_PROVISIONING = S3_PROVISIONING;
