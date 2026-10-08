/** `deploy.objects.<stage>` for the `s3` provider, checked. */

import type { S3ObjectsConfig } from '../../workspace/types.js';
import type { ProviderConfig } from '../types.js';
import { S3ProviderConfigInvalid } from './errors.js';

const FIELDS = ['provider', 'region', 'versioning'] as const;

/** An AWS region code: `eu-west-1`, `us-gov-west-1`, `ap-southeast-4`. */
const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;

export function checkS3Config(
	stage: string,
	config: ProviderConfig,
): S3ObjectsConfig {
	const entry = config as unknown as Record<string, unknown>;
	for (const field of Object.keys(entry)) {
		if (!(FIELDS as readonly string[]).includes(field)) {
			throw new S3ProviderConfigInvalid(
				stage,
				field,
				entry[field],
				`the s3 provider takes ${FIELDS.slice(1).join(' and ')} only`,
			);
		}
	}
	if (entry.region !== undefined) {
		if (typeof entry.region !== 'string' || !REGION.test(entry.region)) {
			throw new S3ProviderConfigInvalid(
				stage,
				'region',
				entry.region,
				"set it to an AWS region code, like 'eu-west-1'",
			);
		}
	}
	if (entry.versioning !== undefined && typeof entry.versioning !== 'boolean') {
		throw new S3ProviderConfigInvalid(
			stage,
			'versioning',
			entry.versioning,
			'set it to true to keep previous versions of every object, or leave it out',
		);
	}
	return entry as unknown as S3ObjectsConfig;
}

/** How the s3 provider's provisioning credentials are supplied. */
export const S3_PROVISIONING = {
	env: [
		'AWS_PROFILE',
		'AWS_ACCESS_KEY_ID',
		'AWS_SECRET_ACCESS_KEY',
		'AWS_SESSION_TOKEN',
	],
	describe:
		"the stage's AWS account — --profile <name>, AWS_PROFILE, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (in CI, what aws-actions/configure-aws-credentials exports)",
} as const;
